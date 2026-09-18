import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { AppShell } from "../components/AppShell";
import { ChatIntro } from "../components/ChatIntro";
import ProductCard, {
  type ProductCardData,
} from "../components/ProductCard";
import {
  SearchScopeEditor,
  type MarketplaceSource,
} from "../components/SearchScopeEditor";
import {
  IconPanel,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSend,
  IconSidebar,
  IconTrash,
  IconX,
} from "../components/icons";
import { MessageMarkdown } from "../components/MessageMarkdown";
import { MAX_SESSION_TITLE_LENGTH } from "../../convex/lib/sessionTitle";

const CONTEXT_PANEL_KEY = "carter.contextPanelOpen";
const MOBILE_LAYOUT_QUERY = "(max-width: 900px)";
const DEFAULT_COMPOSER_PLACEHOLDER =
  "Tell Carter what you’re shopping for…";

/** Split a preference summary into short chips for the context panel. */
function preferenceChipsFromSummary(summary: string | null | undefined): string[] {
  const text = summary?.trim();
  if (!text) return [];
  const parts = text
    .split(/[;•|/]+|\.(?:\s|$)/)
    .map((part) => part.replace(/^[\s,-]+|[\s,-]+$/g, "").trim())
    .filter((part) => part.length >= 2 && part.length <= 48);
  if (parts.length >= 2) return parts.slice(0, 8);
  const commaParts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 40);
  if (commaParts.length >= 2) return commaParts.slice(0, 8);
  if (text.length <= 64) return [text];
  return [`${text.slice(0, 56).trimEnd()}…`];
}

function isMobileViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  );
}

type ReplyQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

type ReplySelection = {
  prompt: string;
  values: string[];
  isOther: boolean;
};

function normalizeUrlKey(url: string) {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function asProductCard(value: unknown): ProductCardData | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!title || !url) return null;
  return {
    title,
    url,
    price: typeof row.price === "number" ? row.price : null,
    currency: typeof row.currency === "string" ? row.currency : null,
    source: typeof row.source === "string" ? row.source : null,
    summary: typeof row.summary === "string" ? row.summary : null,
    imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : null,
  };
}

function toolNameFromPart(part: Record<string, unknown>): string | null {
  if (typeof part.toolName === "string") return part.toolName;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return null;
}

function toolInputFromPart(part: Record<string, unknown>): unknown {
  return part.input ?? part.args;
}

function toolOutputFromPart(part: Record<string, unknown>): unknown {
  return part.output ?? part.result;
}

function asToolRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.value && typeof row.value === "object") {
    return row.value as Record<string, unknown>;
  }
  return row;
}

function queryIdFromCreateOutput(output: unknown): string | null {
  const row = asToolRecord(output);
  if (!row) return null;
  const queryId = row.queryId;
  return typeof queryId === "string" && queryId.trim() ? queryId.trim() : null;
}

function queryIdFromToolInput(input: unknown): string | null {
  const row = asToolRecord(input);
  if (!row) return null;
  const queryId = row.queryId;
  return typeof queryId === "string" && queryId.trim() ? queryId.trim() : null;
}

function titleFromCreateInput(input: unknown): string | null {
  const row = asToolRecord(input);
  if (!row) return null;
  const title = row.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function messageHasCreateOpenQuery(message: UIMessage): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) {
    return false;
  }
  return (message.parts as Array<Record<string, unknown>>).some(
    (part) => toolNameFromPart(part) === "createOpenQuery",
  );
}

/** Jump to the user question that started this query segment, not the tool turn. */
function userQuestionKeyBefore(
  messages: UIMessage[],
  assistantKey: string,
): string {
  const index = messages.findIndex((message) => message.key === assistantKey);
  if (index <= 0) return assistantKey;

  let segmentStart = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (messageHasCreateOpenQuery(messages[i]!)) {
      segmentStart = i + 1;
      break;
    }
  }

  for (let i = segmentStart; i < index; i++) {
    if (messages[i]!.role === "user") return messages[i]!.key;
  }

  for (let i = index - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.key;
  }

  return assistantKey;
}

/** Map open queries to the user message that started them. */
function buildQueryMessageAnchors(messages: UIMessage[] | undefined): {
  byQueryId: Map<string, string>;
  byTitle: Map<string, string>;
} {
  const list = messages ?? [];
  const byQueryId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const searchFallback = new Map<string, string>();

  for (const message of list) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;

    for (const part of message.parts as Array<Record<string, unknown>>) {
      const toolName = toolNameFromPart(part);
      if (!toolName) continue;

      if (toolName === "createOpenQuery") {
        const questionKey = userQuestionKeyBefore(list, message.key);
        const queryId = queryIdFromCreateOutput(toolOutputFromPart(part));
        if (queryId && !byQueryId.has(queryId)) {
          byQueryId.set(queryId, questionKey);
        }
        const title = titleFromCreateInput(toolInputFromPart(part));
        if (title && !byTitle.has(title.toLowerCase())) {
          byTitle.set(title.toLowerCase(), questionKey);
        }
        continue;
      }

      if (
        toolName === "searchProducts" ||
        toolName === "scrapeProduct" ||
        toolName === "listFindings"
      ) {
        const queryId = queryIdFromToolInput(toolInputFromPart(part));
        if (queryId && !searchFallback.has(queryId)) {
          searchFallback.set(
            queryId,
            userQuestionKeyBefore(list, message.key),
          );
        }
      }
    }
  }

  for (const [queryId, messageKey] of searchFallback) {
    if (!byQueryId.has(queryId)) {
      byQueryId.set(queryId, messageKey);
    }
  }

  return { byQueryId, byTitle };
}

function resolveQueryMessageKey(
  query: { _id: string; title: string },
  anchors: {
    byQueryId: Map<string, string>;
    byTitle: Map<string, string>;
  },
): string | null {
  return (
    anchors.byQueryId.get(query._id) ??
    anchors.byTitle.get(query.title.trim().toLowerCase()) ??
    null
  );
}

function productsFromToolOutput(output: unknown): ProductCardData[] {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output
      .map(asProductCard)
      .filter((item): item is ProductCardData => item != null);
  }
  if (typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  if (Array.isArray(record.findings)) {
    return record.findings
      .map(asProductCard)
      .filter((item): item is ProductCardData => item != null);
  }
  if (Array.isArray(record.results)) {
    return record.results
      .map(asProductCard)
      .filter((item): item is ProductCardData => item != null);
  }
  const single = asProductCard(record);
  return single ? [single] : [];
}

function extractProductsFromMessage(
  message: UIMessage,
  findingsByUrl: Map<string, ProductCardData>,
  rejectedUrls: Set<string>,
): ProductCardData[] {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) {
    return [];
  }

  const byUrl = new Map<string, ProductCardData>();

  for (const part of message.parts as Array<Record<string, unknown>>) {
    const toolName = toolNameFromPart(part);
    if (
      toolName !== "searchProducts" &&
      toolName !== "scrapeProduct" &&
      toolName !== "listFindings"
    ) {
      continue;
    }
    if (part.state !== "output-available" && part.state !== "result") {
      continue;
    }
    const output = part.output ?? part.result;
    for (const product of productsFromToolOutput(output)) {
      const key = normalizeUrlKey(product.url);
      if (rejectedUrls.has(key)) continue;
      const fromFinding = findingsByUrl.get(key);
      if (fromFinding?.verdict === "rejected") continue;
      byUrl.set(key, {
        ...product,
        _id: fromFinding?._id ?? product._id,
        price: product.price ?? fromFinding?.price ?? null,
        currency: product.currency ?? fromFinding?.currency ?? null,
        source: product.source ?? fromFinding?.source ?? null,
        summary: product.summary ?? fromFinding?.summary ?? null,
        imageUrl: product.imageUrl ?? fromFinding?.imageUrl ?? null,
        isNew: fromFinding?.isNew,
        verdict: fromFinding?.verdict ?? product.verdict ?? null,
      });
    }
  }

  return Array.from(byUrl.values()).filter(
    (product) => product.verdict !== "rejected",
  );
}

function asReplyQuestion(value: unknown): ReplyQuestion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  if (!id || !prompt || !Array.isArray(row.options)) return null;
  const options = row.options
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (options.length < 2) return null;
  return { id, prompt, options };
}

function replyChoicesFromToolOutput(output: unknown): ReplyQuestion[] {
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  if (!Array.isArray(record.questions)) return [];
  const byId = new Map<string, ReplyQuestion>();
  for (const item of record.questions) {
    const question = asReplyQuestion(item);
    if (question) byId.set(question.id, question);
  }
  return Array.from(byId.values());
}

function replyChoicesPayloadFromPart(
  part: Record<string, unknown>,
): unknown {
  return part.output ?? part.result ?? part.input ?? part.args;
}

function extractReplyChoicesFromMessage(message: UIMessage): ReplyQuestion[] {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) {
    return [];
  }

  const byId = new Map<string, ReplyQuestion>();

  for (const part of message.parts as Array<Record<string, unknown>>) {
    if (toolNameFromPart(part) !== "offerReplyChoices") continue;
    for (const question of replyChoicesFromToolOutput(
      replyChoicesPayloadFromPart(part),
    )) {
      byId.set(question.id, question);
    }
  }

  return Array.from(byId.values());
}

type MarketplaceSuggestion = { domain: string; label: string };

type MarketplaceSuggestionBundle = {
  queryId: Id<"openQueries">;
  suggestions: MarketplaceSuggestion[];
};

function asMarketplaceSuggestion(value: unknown): MarketplaceSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const domain = typeof row.domain === "string" ? row.domain.trim().toLowerCase() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!domain) return null;
  return { domain, label: label || domain };
}

function marketplaceSuggestionsFromToolOutput(
  output: unknown,
): MarketplaceSuggestionBundle | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const queryId =
    typeof record.queryId === "string" ? record.queryId.trim() : "";
  if (!queryId || !Array.isArray(record.suggestions)) return null;
  const suggestions: MarketplaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of record.suggestions) {
    const suggestion = asMarketplaceSuggestion(item);
    if (!suggestion || seen.has(suggestion.domain)) continue;
    seen.add(suggestion.domain);
    suggestions.push(suggestion);
  }
  if (suggestions.length === 0) return null;
  return {
    queryId: queryId as Id<"openQueries">,
    suggestions,
  };
}

function extractMarketplaceSuggestionsFromMessage(
  message: UIMessage,
): MarketplaceSuggestionBundle | null {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) {
    return null;
  }

  let latest: MarketplaceSuggestionBundle | null = null;
  for (const part of message.parts as Array<Record<string, unknown>>) {
    if (toolNameFromPart(part) !== "discoverMarketplaces") continue;
    if (part.state !== "output-available" && part.state !== "result") continue;
    const bundle = marketplaceSuggestionsFromToolOutput(
      part.output ?? part.result,
    );
    if (bundle) latest = bundle;
  }
  return latest;
}

function buildDraftFromReplySelections(
  questions: ReplyQuestion[],
  selections: Record<string, ReplySelection>,
): string {
  return questions
    .filter((question) => {
      const selection = selections[question.id];
      return (
        selection != null &&
        (selection.values.length > 0 || selection.isOther)
      );
    })
    .map((question) => {
      const selection = selections[question.id]!;
      const ordered = question.options.filter((option) =>
        selection.values.includes(option),
      );
      const joined = ordered.join(", ");
      if (selection.isOther) {
        return joined
          ? `${selection.prompt}: ${joined}, `
          : `${selection.prompt}: `;
      }
      return `${selection.prompt}: ${joined}`;
    })
    .join("\n");
}

function ReplyChoices({
  questions,
  selections,
  interactive,
  onToggle,
}: {
  questions: ReplyQuestion[];
  selections: Record<string, ReplySelection>;
  interactive: boolean;
  onToggle: (question: ReplyQuestion, option: string | null) => void;
}) {
  if (questions.length === 0) return null;

  return (
    <div className="reply-choices" aria-label="Suggested replies">
      {questions.map((question) => {
        const selected = selections[question.id];
        return (
          <div className="reply-choice-question" key={question.id}>
            <div className="reply-choice-prompt">{question.prompt}</div>
            <div
              className="chips reply-choice-chips"
              role="group"
              aria-label={`${question.prompt} (select all that apply)`}
            >
              {question.options.map((option) => {
                const isSelected = selected?.values.includes(option) ?? false;
                return (
                  <button
                    key={option}
                    type="button"
                    className={`chip chip-reply${isSelected ? " is-selected" : ""}`}
                    disabled={!interactive}
                    aria-pressed={isSelected}
                    onClick={() => onToggle(question, option)}
                  >
                    {option}
                  </button>
                );
              })}
              <button
                type="button"
                className={`chip chip-reply chip-reply-other${
                  selected?.isOther ? " is-selected" : ""
                }`}
                disabled={!interactive}
                aria-pressed={selected?.isOther ?? false}
                onClick={() => onToggle(question, null)}
              >
                Other
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarketplaceStoreChips({
  bundle,
  selectedDomains,
  interactive,
  busy,
  onToggleDomain,
  onAdd,
  onSkip,
}: {
  bundle: MarketplaceSuggestionBundle;
  selectedDomains: string[];
  interactive: boolean;
  busy: boolean;
  onToggleDomain: (domain: string) => void;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="reply-choices marketplace-store-chips" aria-label="Suggested stores">
      <div className="reply-choice-question">
        <div className="reply-choice-prompt">Stores to add</div>
        <div
          className="chips reply-choice-chips"
          role="group"
          aria-label="Specialty stores (select all that apply)"
        >
          {bundle.suggestions.map((suggestion) => {
            const isSelected = selectedDomains.includes(suggestion.domain);
            return (
              <button
                key={suggestion.domain}
                type="button"
                className={`chip chip-reply${isSelected ? " is-selected" : ""}`}
                disabled={!interactive || busy}
                aria-pressed={isSelected}
                title={suggestion.domain}
                onClick={() => onToggleDomain(suggestion.domain)}
              >
                {suggestion.domain}
              </button>
            );
          })}
        </div>
        {interactive ? (
          <div className="marketplace-store-actions">
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={busy || selectedDomains.length === 0}
              onClick={onAdd}
            >
              {busy ? "Adding…" : "Add selected stores"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={busy}
              onClick={onSkip}
            >
              Skip
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  findingsByUrl,
  rejectedUrls,
  replyInteractive,
  replySelections,
  onToggleReply,
  storeInteractive,
  selectedStoreDomains,
  storeBusy,
  onToggleStoreDomain,
  onAddStores,
  onSkipStores,
  onSetVerdict,
  highlighted,
}: {
  message: UIMessage;
  findingsByUrl: Map<string, ProductCardData>;
  rejectedUrls: Set<string>;
  replyInteractive: boolean;
  replySelections: Record<string, ReplySelection>;
  onToggleReply: (question: ReplyQuestion, option: string | null) => void;
  storeInteractive: boolean;
  selectedStoreDomains: string[];
  storeBusy: boolean;
  onToggleStoreDomain: (domain: string) => void;
  onAddStores: () => void;
  onSkipStores: () => void;
  onSetVerdict: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void | Promise<void>;
  highlighted?: boolean;
}) {
  const [text] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });
  const role = message.role === "user" ? "user" : "assistant";
  const products = useMemo(
    () => extractProductsFromMessage(message, findingsByUrl, rejectedUrls),
    [message, findingsByUrl, rejectedUrls],
  );
  const replyChoices = useMemo(
    () => extractReplyChoicesFromMessage(message),
    [message],
  );
  const marketplaceBundle = useMemo(
    () => extractMarketplaceSuggestionsFromMessage(message),
    [message],
  );

  return (
    <article
      className={`message ${role}${highlighted ? " is-highlighted" : ""}`}
      data-message-key={message.key}
    >
      <div className="meta">{role === "user" ? "You" : "Carter"}</div>
      <div className="body">
        {text ? (
          role === "assistant" ? (
            <MessageMarkdown text={text} />
          ) : (
            text
          )
        ) : message.status === "streaming" ? (
          <span className="message-streaming" aria-label="Carter is thinking">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>
      {products.length > 0 ? (
        <>
          <div className="product-grid" aria-label="Product recommendations">
            {products.map((product) => (
              <ProductCard
                key={product.url}
                variant="inline"
                product={product}
                onSetVerdict={onSetVerdict}
              />
            ))}
          </div>
          <p className="product-learning-note" role="note">
            Like or pass here — open Findings for details and lists.
          </p>
        </>
      ) : null}
      {replyChoices.length > 0 ? (
        <ReplyChoices
          questions={replyChoices}
          selections={replySelections}
          interactive={replyInteractive}
          onToggle={onToggleReply}
        />
      ) : null}
      {marketplaceBundle ? (
        <MarketplaceStoreChips
          bundle={marketplaceBundle}
          selectedDomains={
            storeInteractive ? selectedStoreDomains : []
          }
          interactive={storeInteractive}
          busy={storeBusy}
          onToggleDomain={onToggleStoreDomain}
          onAdd={onAddStores}
          onSkip={onSkipStores}
        />
      ) : null}
    </article>
  );
}

const ACTIVE_SESSION_KEY_PREFIX = "carter.activeSession.";
const THREADS_SIDEBAR_KEY = "carter.threadsSidebarOpen";

function activeSessionStorageKey(userId: string) {
  return `${ACTIVE_SESSION_KEY_PREFIX}${userId}`;
}

function readStoredSessionId(userId: string): Id<"sessions"> | null {
  try {
    const raw = localStorage.getItem(activeSessionStorageKey(userId));
    return raw ? (raw as Id<"sessions">) : null;
  } catch {
    return null;
  }
}

function storeActiveSessionId(userId: string, sessionId: Id<"sessions">) {
  try {
    localStorage.setItem(activeSessionStorageKey(userId), sessionId);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function readThreadsSidebarOpen(): boolean {
  try {
    const raw = localStorage.getItem(THREADS_SIDEBAR_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function storeThreadsSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(THREADS_SIDEBAR_KEY, open ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function readContextPanelOpen() {
  try {
    const raw = localStorage.getItem(CONTEXT_PANEL_KEY);
    if (raw == null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function storeContextPanelOpen(open: boolean) {
  try {
    localStorage.setItem(CONTEXT_PANEL_KEY, open ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

type OpenQueryRow = {
  _id: Id<"openQueries">;
  title: string;
  brief: string;
  status: "gathering" | "active" | "paused";
  sources: MarketplaceSource[] | null;
  customDomains: string[] | null;
  lastCheckedAt: number | null;
};

function defaultSources(
  sources: MarketplaceSource[] | null,
): MarketplaceSource[] {
  // null = legacy unset → all on; [] = user cleared marketplaces (custom-only).
  if (sources === null) return ["amazon", "etsy", "web"];
  return sources;
}

function OpenQueryCard({
  query,
  messageKey,
  onJump,
  onUpdateScope,
}: {
  query: OpenQueryRow;
  messageKey: string | null;
  onJump: (key: string) => void;
  onUpdateScope: (
    queryId: Id<"openQueries">,
    sources: MarketplaceSource[],
    customDomains: string[],
  ) => Promise<void>;
}) {
  const sources = defaultSources(query.sources);
  const domains = query.customDomains ?? [];

  return (
    <div className="query-card">
      <strong>{query.title}</strong>
      <p>{query.brief}</p>
      <div className="query-card-footer">
        <span
          className={`badge${query.status === "active" ? " badge-status-active" : ""}`}
        >
          {query.status}
        </span>
        {messageKey ? (
          <button
            type="button"
            className="query-jump-btn"
            onClick={() => onJump(messageKey)}
          >
            View in chat
          </button>
        ) : null}
      </div>

      <SearchScopeEditor
        sources={sources}
        customDomains={domains}
        onChange={(nextSources, nextDomains) =>
          onUpdateScope(query._id, nextSources, nextDomains)
        }
      />
      {sources.includes("web") ? (
        <p className="hint query-discover-hint">
          Carter can suggest specialty sites as chips when Discover stores is
          on.
        </p>
      ) : null}
    </div>
  );
}

export default function ChatApp() {
  const { data: authSession } = authClient.useSession();
  const ensureSession = useMutation(api.sessions.getOrCreate);
  const createSession = useMutation(api.sessions.create);
  const removeSession = useMutation(api.sessions.remove);
  const renameSession = useMutation(api.sessions.rename);
  const conversations = useQuery(
    api.sessions.list,
    authSession?.user?.id ? {} : "skip",
  );
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [pendingBootstrap, setPendingBootstrap] = useState<{
    sessionId: Id<"sessions">;
    threadId: string;
  } | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(readThreadsSidebarOpen);
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  const [contextOpen, setContextOpen] = useState(() =>
    isMobileViewport() ? false : readContextPanelOpen(),
  );
  const [threadsLeaving, setThreadsLeaving] = useState(false);
  const [contextLeaving, setContextLeaving] = useState(false);
  const sheetExitTimersRef = useRef<{
    threads?: ReturnType<typeof setTimeout>;
    context?: ReturnType<typeof setTimeout>;
  }>({});
  const [threadSearch, setThreadSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [replySelections, setReplySelections] = useState<
    Record<string, ReplySelection>
  >({});
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [deletingSessionId, setDeletingSessionId] =
    useState<Id<"sessions"> | null>(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] =
    useState<Id<"sessions"> | null>(null);
  const confirmDeleteRef = useRef<HTMLLIElement | null>(null);
  const [editingSessionId, setEditingSessionId] =
    useState<Id<"sessions"> | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameBaselineRef = useRef("");
  const skipRenameBlurRef = useRef(false);
  const [highlightedMessageKey, setHighlightedMessageKey] = useState<
    string | null
  >(null);
  const highlightTimerRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const activeTitle =
    conversations?.find((row) => row.sessionId === sessionId)?.title ??
    "New chat";

  const composerPlaceholder = useMemo(() => {
    if (activeTitle && activeTitle !== "New chat") {
      const short =
        activeTitle.length > 72
          ? `${activeTitle.slice(0, 69).trimEnd()}…`
          : activeTitle;
      return `Continue: ${short}`;
    }
    return DEFAULT_COMPOSER_PLACEHOLDER;
  }, [activeTitle]);

  const filteredConversations = useMemo(() => {
    const rows = conversations ?? [];
    const q = threadSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.title.toLowerCase().includes(q));
  }, [conversations, threadSearch]);

  function closeThreadsSidebar(options?: { animated?: boolean }) {
    const animated =
      options?.animated !== false &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches;

    if (!animated || !threadsOpen) {
      window.clearTimeout(sheetExitTimersRef.current.threads);
      setThreadsLeaving(false);
      setThreadsOpen(false);
      storeThreadsSidebarOpen(false);
      return;
    }

    setThreadsLeaving(true);
    window.clearTimeout(sheetExitTimersRef.current.threads);
    sheetExitTimersRef.current.threads = setTimeout(() => {
      setThreadsOpen(false);
      storeThreadsSidebarOpen(false);
      setThreadsLeaving(false);
    }, 180);
  }

  function openThreadsSidebar() {
    window.clearTimeout(sheetExitTimersRef.current.threads);
    setThreadsLeaving(false);
    setThreadsOpen(true);
    storeThreadsSidebarOpen(true);
  }

  function selectConversation(
    nextSessionId: Id<"sessions">,
    nextThreadId: string,
    options?: { preserveSidebar?: boolean },
  ) {
    setSessionId(nextSessionId);
    setThreadId(nextThreadId);
    setDraft("");
    setReplySelections({});
    setHighlightedMessageKey(null);
    stickToBottomRef.current = true;
    const userId = authSession?.user?.id;
    if (userId) storeActiveSessionId(userId, nextSessionId);
    if (
      !options?.preserveSidebar &&
      threadsOpen &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
    ) {
      closeThreadsSidebar({ animated: true });
    }
  }

  function toggleThreadsSidebar() {
    if (threadsOpen) {
      closeThreadsSidebar({ animated: true });
      return;
    }
    openThreadsSidebar();
  }

  function toggleContextPanel() {
    if (contextOpen) {
      closeContextPanel();
      return;
    }
    const next = true;
    if (isMobileViewport()) {
      if (threadsOpen) {
        closeThreadsSidebar({ animated: true });
      }
    } else {
      storeContextPanelOpen(next);
    }
    window.clearTimeout(sheetExitTimersRef.current.context);
    setContextLeaving(false);
    setContextOpen(next);
  }

  function closeContextPanel() {
    const animated =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches;

    if (!animated || !contextOpen) {
      window.clearTimeout(sheetExitTimersRef.current.context);
      setContextLeaving(false);
      setContextOpen(false);
      if (!isMobileViewport()) {
        storeContextPanelOpen(false);
      }
      return;
    }

    setContextLeaving(true);
    window.clearTimeout(sheetExitTimersRef.current.context);
    sheetExitTimersRef.current.context = setTimeout(() => {
      setContextOpen(false);
      setContextLeaving(false);
    }, 180);
  }

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    function onViewportChange() {
      const mobile = media.matches;
      setIsMobile(mobile);
      if (mobile) {
        setContextOpen(false);
      } else {
        setContextOpen(readContextPanelOpen());
      }
    }
    media.addEventListener("change", onViewportChange);
    return () => media.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    if (!contextOpen || !isMobile) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextPanel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [contextOpen, isMobile]);

  function openSidebarForSearch() {
    if (!threadsOpen) {
      openThreadsSidebar();
    }
    queueMicrotask(() => searchInputRef.current?.focus());
  }

  async function onNewChat() {
    if (creatingChat) return;
    setCreatingChat(true);
    try {
      const session = await createSession({});
      selectConversation(session.sessionId, session.threadId);
      setThreadSearch("");
    } finally {
      setCreatingChat(false);
    }
  }

  useEffect(() => {
    if (!confirmDeleteSessionId) return;
    function onPointerDown(event: MouseEvent) {
      if (!confirmDeleteRef.current?.contains(event.target as Node)) {
        setConfirmDeleteSessionId(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmDeleteSessionId(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmDeleteSessionId]);

  useEffect(() => {
    if (!editingSessionId) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingSessionId]);

  function startRename(
    targetSessionId: Id<"sessions">,
    currentTitle: string,
  ) {
    if (deletingSessionId || renaming) return;
    setConfirmDeleteSessionId(null);
    skipRenameBlurRef.current = false;
    renameBaselineRef.current = currentTitle;
    setTitleDraft(currentTitle);
    setEditingSessionId(targetSessionId);
    if (!threadsOpen) {
      openThreadsSidebar();
    }
  }

  function cancelRename() {
    skipRenameBlurRef.current = true;
    setEditingSessionId(null);
    setTitleDraft("");
    setRenaming(false);
  }

  async function commitRename() {
    if (!editingSessionId || renaming) return;
    const nextTitle = titleDraft.trim();
    const baseline = renameBaselineRef.current;
    if (!nextTitle || nextTitle === baseline) {
      cancelRename();
      return;
    }

    setRenaming(true);
    try {
      await renameSession({
        sessionId: editingSessionId,
        title: nextTitle,
      });
      cancelRename();
    } catch {
      skipRenameBlurRef.current = false;
      setTitleDraft(baseline);
      setRenaming(false);
      queueMicrotask(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }

  function onRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  async function onConfirmDeleteConversation(
    targetSessionId: Id<"sessions">,
  ) {
    if (deletingSessionId) return;

    const wasActive = targetSessionId === sessionId;
    const remaining = (conversations ?? []).filter(
      (row) => row.sessionId !== targetSessionId,
    );

    setConfirmDeleteSessionId(null);
    setDeletingSessionId(targetSessionId);

    try {
      // Move off the doomed chat first so the main panel never flashes empty.
      if (wasActive && remaining[0]) {
        selectConversation(remaining[0].sessionId, remaining[0].threadId, {
          preserveSidebar: true,
        });
      }

      const next = await removeSession({ sessionId: targetSessionId });

      if (wasActive) {
        const alreadyOnNext =
          remaining[0] && remaining[0].sessionId === next.sessionId;
        if (!alreadyOnNext) {
          selectConversation(next.sessionId, next.threadId, {
            preserveSidebar: true,
          });
        }
      }
    } finally {
      setDeletingSessionId(null);
    }
  }

  useEffect(() => {
    if (!authSession?.user?.id) return;
    let cancelled = false;
    setSessionId(null);
    setThreadId(null);
    setPendingBootstrap(null);

    void ensureSession({}).then((bootstrap) => {
      if (cancelled) return;
      setPendingBootstrap({
        sessionId: bootstrap.sessionId,
        threadId: bootstrap.threadId,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authSession?.user?.id, ensureSession]);

  useEffect(() => {
    if (!authSession?.user?.id || conversations === undefined || !pendingBootstrap) {
      return;
    }
    const userId = authSession.user.id;
    const storedId = readStoredSessionId(userId);
    const active =
      (storedId &&
        conversations.find((row) => row.sessionId === storedId)) ||
      conversations.find(
        (row) => row.sessionId === pendingBootstrap.sessionId,
      ) ||
      conversations[0];

    if (active) {
      setSessionId(active.sessionId);
      setThreadId(active.threadId);
      storeActiveSessionId(userId, active.sessionId);
    } else {
      setSessionId(pendingBootstrap.sessionId);
      setThreadId(pendingBootstrap.threadId);
      storeActiveSessionId(userId, pendingBootstrap.sessionId);
    }
    setPendingBootstrap(null);
  }, [authSession?.user?.id, conversations, pendingBootstrap]);

  const profile = useQuery(
    api.profiles.getForSession,
    sessionId ? { sessionId } : "skip",
  );
  const openQueries = useQuery(
    api.openQueries.listForSession,
    sessionId ? { sessionId } : "skip",
  );
  const findings = useQuery(
    api.findings.listForSession,
    sessionId ? { sessionId } : "skip",
  );
  const rejectedUrlList = useQuery(
    api.findings.listRejectedUrlsForSession,
    sessionId ? { sessionId } : "skip",
  );
  const shoppingLists = useQuery(
    api.shoppingLists.listMine,
    authSession?.user?.id ? {} : "skip",
  );

  const { results: messages } = useUIMessages(
    api.chat.listMessages,
    sessionId && threadId ? { threadId, sessionId } : "skip",
    { initialNumItems: 40, stream: true },
  );

  const interactiveReplyMessageKey = useMemo(() => {
    const list = messages ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i];
      if (!message || message.role !== "assistant") continue;
      if (extractReplyChoicesFromMessage(message).length > 0) {
        return message.key;
      }
    }
    return null;
  }, [messages]);

  const interactiveStoreMessageKey = useMemo(() => {
    const list = messages ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i];
      if (!message) continue;
      if (message.role !== "assistant") {
        // A newer user turn means store chips on older messages are done.
        return null;
      }
      if (extractMarketplaceSuggestionsFromMessage(message)) {
        return message.key;
      }
      // Latest assistant turn has no store suggestions.
      return null;
    }
    return null;
  }, [messages]);

  const interactiveStoreBundle = useMemo(() => {
    if (!interactiveStoreMessageKey) return null;
    const message = (messages ?? []).find(
      (row) => row.key === interactiveStoreMessageKey,
    );
    return message
      ? extractMarketplaceSuggestionsFromMessage(message)
      : null;
  }, [messages, interactiveStoreMessageKey]);

  const interactiveReplyQuestions = useMemo(() => {
    if (!interactiveReplyMessageKey) return [] as ReplyQuestion[];
    const message = (messages ?? []).find(
      (row) => row.key === interactiveReplyMessageKey,
    );
    return message ? extractReplyChoicesFromMessage(message) : [];
  }, [messages, interactiveReplyMessageKey]);

  const [selectedStoreDomains, setSelectedStoreDomains] = useState<string[]>(
    [],
  );
  const [storeActionBusy, setStoreActionBusy] = useState(false);

  useEffect(() => {
    setSelectedStoreDomains([]);
    setStoreActionBusy(false);
  }, [interactiveStoreMessageKey]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sessionId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const queryMessageAnchors = useMemo(
    () => buildQueryMessageAnchors(messages),
    [messages],
  );

  function onMessagesScroll() {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  }

  function jumpToMessage(messageKey: string) {
    const root = messagesRef.current;
    if (!root) return;
    const target = root.querySelector(
      `[data-message-key="${CSS.escape(messageKey)}"]`,
    );
    if (!(target instanceof HTMLElement)) return;

    if (isMobileViewport()) {
      closeContextPanel();
    }

    stickToBottomRef.current = false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageKey(messageKey);
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageKey((current) =>
        current === messageKey ? null : current,
      );
      highlightTimerRef.current = null;
    }, 2200);
  }

  const findingsByUrl = useMemo(() => {
    const map = new Map<string, ProductCardData>();
    for (const finding of findings ?? []) {
      map.set(normalizeUrlKey(finding.url), {
        _id: finding._id,
        title: finding.title,
        url: finding.url,
        price: finding.price,
        currency: finding.currency,
        source: finding.source,
        summary: finding.summary,
        imageUrl: finding.imageUrl,
        isNew: finding.isNew,
        verdict: finding.verdict,
      });
    }
    return map;
  }, [findings]);

  const contextSummary = useMemo(() => {
    const allFindings = findings ?? [];
    const queries = openQueries ?? [];
    const newFindsCount = allFindings.filter((f) => f.isNew).length;
    const preferredQuery =
      queries.find((q) => q.status === "active") ??
      queries.find((q) => q.status === "gathering") ??
      queries[0];

    const parts: string[] = [];
    if (newFindsCount > 0) {
      parts.push(
        `${newFindsCount} new find${newFindsCount === 1 ? "" : "s"}`,
      );
    } else if (allFindings.length > 0) {
      parts.push(
        `${allFindings.length} find${allFindings.length === 1 ? "" : "s"}`,
      );
    }

    if (preferredQuery) {
      const statusLabel =
        preferredQuery.status === "active"
          ? "Active"
          : preferredQuery.status === "gathering"
            ? "Gathering"
            : "Paused";
      const title = preferredQuery.title.trim() || preferredQuery.brief.trim();
      if (title) {
        parts.push(`${statusLabel}: ${title}`);
      }
    }

    if (parts.length === 0) {
      return "No active hunt · Tap for shopping context";
    }
    return parts.join(" · ");
  }, [findings, openQueries]);

  const rejectedUrls = useMemo(() => {
    const set = new Set<string>();
    for (const url of rejectedUrlList ?? []) {
      set.add(normalizeUrlKey(url));
    }
    return set;
  }, [rejectedUrlList]);

  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    (store, args) => {
      optimisticallySendMessage(api.chat.listMessages)(store, {
        threadId: args.threadId,
        prompt: args.prompt,
      });
    },
  );
  const setVerdict = useMutation(api.findings.setVerdict);
  const createList = useMutation(api.shoppingLists.create);
  const addListItem = useMutation(api.shoppingLists.addItem);
  const updateSearchScope = useMutation(api.openQueries.updateSearchScope);
  const addCustomDomains = useMutation(api.openQueries.addCustomDomains);

  async function onSetVerdict(
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) {
    await setVerdict({ findingId, verdict });
  }

  async function onAddToList(
    findingId: Id<"findings">,
    target: Id<"shoppingLists"> | { createName: string },
  ): Promise<Id<"shoppingLists">> {
    let listId: Id<"shoppingLists">;
    if (typeof target === "object" && "createName" in target) {
      listId = await createList({ name: target.createName });
    } else {
      listId = target;
    }
    await addListItem({ listId, findingId });
    return listId;
  }

  function onToggleReply(question: ReplyQuestion, option: string | null) {
    const previous = replySelections[question.id];
    let values = previous?.values ?? [];
    let isOther = previous?.isOther ?? false;

    if (option === null) {
      isOther = !isOther;
    } else if (values.includes(option)) {
      values = values.filter((value) => value !== option);
    } else {
      values = [...values, option];
    }

    const next: Record<string, ReplySelection> = { ...replySelections };
    if (values.length === 0 && !isOther) {
      delete next[question.id];
    } else {
      next[question.id] = {
        prompt: question.prompt,
        values,
        isOther,
      };
    }

    setReplySelections(next);
    setDraft(buildDraftFromReplySelections(interactiveReplyQuestions, next));
    queueMicrotask(() => composerRef.current?.focus());
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !threadId || !draft.trim() || sending) return;
    setSending(true);
    stickToBottomRef.current = true;
    const prompt = draft.trim();
    setDraft("");
    setReplySelections({});
    try {
      await sendMessage({ sessionId, threadId, prompt });
    } finally {
      setSending(false);
    }
  }

  function onToggleStoreDomain(domain: string) {
    setSelectedStoreDomains((current) =>
      current.includes(domain)
        ? current.filter((item) => item !== domain)
        : [...current, domain],
    );
  }

  async function sendStoreFollowUp(prompt: string) {
    if (!sessionId || !threadId || sending || storeActionBusy) return;
    setStoreActionBusy(true);
    setSending(true);
    stickToBottomRef.current = true;
    setDraft("");
    setReplySelections({});
    setSelectedStoreDomains([]);
    try {
      await sendMessage({ sessionId, threadId, prompt });
    } finally {
      setSending(false);
      setStoreActionBusy(false);
    }
  }

  async function onAddStores() {
    if (
      !sessionId ||
      !threadId ||
      !interactiveStoreBundle ||
      selectedStoreDomains.length === 0 ||
      sending ||
      storeActionBusy
    ) {
      return;
    }
    const prompt = `Added stores: ${selectedStoreDomains.join(", ")} — please search those.`;
    setStoreActionBusy(true);
    setSending(true);
    stickToBottomRef.current = true;
    setDraft("");
    setReplySelections({});
    setSelectedStoreDomains([]);
    try {
      // Server merges onto existing sources/domains so Profile defaults are kept.
      await addCustomDomains({
        sessionId,
        queryId: interactiveStoreBundle.queryId,
        domains: selectedStoreDomains,
      });
      await sendMessage({ sessionId, threadId, prompt });
    } finally {
      setSending(false);
      setStoreActionBusy(false);
    }
  }

  async function onSkipStores() {
    await sendStoreFollowUp(
      "Skip extra stores — search with my current sources.",
    );
  }

  const knowsSummary =
    profile?.summary?.trim() ||
    "Preferences appear here as Carter learns your taste.";
  const knowsChips = preferenceChipsFromSummary(profile?.summary ?? null);
  const hasLearnedPrefs = knowsChips.length > 0;

  function focusComposer() {
    composerRef.current?.focus();
  }

  const contextPanel =
    contextOpen ? (
      <aside
        id="context-panel"
        className={`panel context-panel${isMobile ? " context-panel--sheet" : ""}${contextLeaving ? " is-leaving" : ""}`}
        aria-label="Shopping context"
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? true : undefined}
      >
        <div className="context-sheet-header">
          <h2 className="context-sheet-title">Shopping context</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={closeContextPanel}
            aria-label="Close context"
          >
            <IconX />
          </button>
        </div>
        <div className="context-stack">
          <section className="side-panel context-section">
            <h3>What Carter knows</h3>
            {hasLearnedPrefs ? (
              <ul className="knows-chips" aria-label={knowsSummary}>
                {knowsChips.map((chip) => (
                  <li key={chip} className="knows-chip">
                    {chip}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-prompt">
                <p>
                  Tell Carter what you&apos;re shopping for — preferences show
                  up here as chips.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  onClick={focusComposer}
                >
                  Start in chat
                </button>
              </div>
            )}
          </section>

          <section className="side-panel context-section">
            <h3>Open queries</h3>
            <p className="hint">
              Live shopping briefs Carter is watching. Choose marketplaces or
              sites to search, or jump to the chat turn.
            </p>
            <p className="hint query-defaults-hint">
              Set default sites for new queries in{" "}
              <Link to="/app/profile">Profile</Link>. You can still change
              sites on any query after it starts.
            </p>
            <div className="query-list">
              {(openQueries ?? []).length === 0 ? (
                <div className="empty-prompt">
                  <p>
                    No open queries yet — ask Carter to hunt for something
                    specific.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={focusComposer}
                  >
                    Start a search
                  </button>
                </div>
              ) : (
                (openQueries ?? []).map((query) => {
                  const messageKey = resolveQueryMessageKey(
                    query,
                    queryMessageAnchors,
                  );
                  return (
                    <OpenQueryCard
                      key={query._id}
                      query={query as OpenQueryRow}
                      messageKey={messageKey}
                      onJump={jumpToMessage}
                      onUpdateScope={async (
                        queryId,
                        sources,
                        customDomains,
                      ) => {
                        if (!sessionId) return;
                        await updateSearchScope({
                          sessionId,
                          queryId,
                          sources,
                          customDomains,
                        });
                      }}
                    />
                  );
                })
              )}
            </div>
          </section>

          <section className="side-panel context-section">
            <h3>Findings</h3>
            <p className="hint">
              Products Carter found. Like to keep, Pass to hide, or add to a
              shopping list when you intend to buy.
            </p>
            <div className="finding-list">
              {(findings ?? []).length === 0 ? (
                <div className="empty-prompt">
                  <p>
                    Nothing found yet. Once Carter hunts, picks land here for
                    Like / Pass.
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={focusComposer}
                  >
                    Ask Carter to hunt
                  </button>
                </div>
              ) : (
                (findings ?? []).map((finding) => (
                  <ProductCard
                    key={finding._id}
                    variant="finding"
                    product={{
                      _id: finding._id,
                      title: finding.title,
                      url: finding.url,
                      price: finding.price,
                      currency: finding.currency,
                      source: finding.source,
                      summary: finding.summary,
                      imageUrl: finding.imageUrl,
                      isNew: finding.isNew,
                      verdict: finding.verdict,
                    }}
                    onSetVerdict={onSetVerdict}
                    shoppingLists={shoppingLists ?? undefined}
                    onAddToList={onAddToList}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </aside>
    ) : null;

  return (
    <AppShell variant="chat">
      <div
        className={`workspace${threadsOpen ? " workspace--threads" : " workspace--rail"}${contextOpen && !isMobile ? " workspace--context" : " workspace--context-collapsed"}`}
      >
        {threadsOpen ? (
          <button
            type="button"
            className={`threads-backdrop${threadsLeaving ? " is-leaving" : ""}`}
            aria-label="Close chat sidebar"
            onClick={toggleThreadsSidebar}
          />
        ) : null}

        <aside
          id="threads-sidebar"
          className={`panel threads-sidebar${threadsOpen ? " is-open" : " is-collapsed"}${threadsLeaving ? " is-leaving" : ""}`}
          aria-label="Conversations"
        >
          {threadsOpen ? (
            <>
              <div className="threads-sidebar-top">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleThreadsSidebar}
                  aria-label="Hide chat sidebar"
                  aria-pressed={true}
                  aria-controls="threads-sidebar"
                >
                  <IconSidebar />
                </button>
              </div>

              <button
                type="button"
                className="threads-new-chat"
                onClick={() => void onNewChat()}
                disabled={creatingChat}
              >
                {creatingChat ? "Starting…" : "New Chat"}
              </button>

              <label className="threads-search">
                <IconSearch />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={threadSearch}
                  onChange={(event) => setThreadSearch(event.target.value)}
                  placeholder="Search your threads…"
                  aria-label="Search your threads"
                />
              </label>

              <ul className="thread-list">
                {filteredConversations.length === 0 ? (
                  <li className="thread-list-empty">
                    {conversations === undefined
                      ? "Loading chats…"
                      : threadSearch.trim()
                        ? "No matching threads"
                        : "No chats yet"}
                  </li>
                ) : (
                  filteredConversations.map((row) => {
                    const active = row.sessionId === sessionId;
                    const deleting = deletingSessionId === row.sessionId;
                    const confirming =
                      confirmDeleteSessionId === row.sessionId;
                    const editing = editingSessionId === row.sessionId;
                    return (
                      <li
                        key={row.sessionId}
                        ref={confirming ? confirmDeleteRef : undefined}
                        className={`thread-row${active ? " is-active" : ""}${confirming ? " is-confirming" : ""}${editing ? " is-editing" : ""}`}
                      >
                        {editing ? (
                          <input
                            ref={renameInputRef}
                            className="thread-item-rename"
                            value={titleDraft}
                            maxLength={MAX_SESSION_TITLE_LENGTH}
                            aria-label="Conversation name"
                            disabled={renaming}
                            onChange={(event) =>
                              setTitleDraft(event.target.value)
                            }
                            onBlur={() => {
                              if (skipRenameBlurRef.current) {
                                skipRenameBlurRef.current = false;
                                return;
                              }
                              if (!renaming) void commitRename();
                            }}
                            onKeyDown={onRenameKeyDown}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`thread-item${active ? " is-active" : ""}`}
                              onClick={() =>
                                selectConversation(row.sessionId, row.threadId)
                              }
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                startRename(row.sessionId, row.title);
                              }}
                              aria-current={active ? "true" : undefined}
                              title={`${row.title} — double-click to rename`}
                              disabled={deleting}
                            >
                              <span className="thread-item-title">
                                {row.title}
                              </span>
                            </button>
                            <div className="thread-item-actions">
                              <button
                                type="button"
                                className="thread-item-action"
                                aria-label={`Rename conversation: ${row.title}`}
                                title="Rename"
                                disabled={
                                  deleting || deletingSessionId !== null
                                }
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  startRename(row.sessionId, row.title);
                                }}
                              >
                                <IconPencil />
                              </button>
                              <button
                                type="button"
                                className="thread-item-action thread-item-delete"
                                aria-label={`Delete conversation: ${row.title}`}
                                aria-expanded={confirming}
                                aria-haspopup="dialog"
                                title="Delete conversation"
                                disabled={
                                  deleting || deletingSessionId !== null
                                }
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setConfirmDeleteSessionId((current) =>
                                    current === row.sessionId
                                      ? null
                                      : row.sessionId,
                                  );
                                }}
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </>
                        )}
                        {confirming ? (
                          <div
                            className="thread-delete-popover"
                            role="dialog"
                            aria-label="Confirm delete conversation"
                          >
                            <p className="thread-delete-popover-copy">
                              Delete this conversation? This cannot be undone.
                            </p>
                            <div className="thread-delete-popover-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-compact"
                                onClick={() => setConfirmDeleteSessionId(null)}
                                disabled={deleting}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn-compact thread-delete-confirm"
                                onClick={() =>
                                  void onConfirmDeleteConversation(
                                    row.sessionId,
                                  )
                                }
                                disabled={deleting}
                              >
                                {deleting ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          ) : (
            <div className="threads-rail">
              <button
                type="button"
                className="icon-btn"
                onClick={toggleThreadsSidebar}
                aria-label="Show chat sidebar"
                aria-pressed={false}
                aria-controls="threads-sidebar"
              >
                <IconSidebar />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={openSidebarForSearch}
                aria-label="Search chats"
              >
                <IconSearch />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void onNewChat()}
                disabled={creatingChat}
                aria-label="New chat"
              >
                <IconPlus />
              </button>
            </div>
          )}
        </aside>

        <div className="layout">
          <section className="panel chat-panel" aria-label="Chat with Carter">
            <div className="chat-header">
              <div className="chat-header-copy">
                <h2
                  className="chat-header-title"
                  title={`${activeTitle} — double-click to rename`}
                  onDoubleClick={() => {
                    if (sessionId) startRename(sessionId, activeTitle);
                  }}
                >
                  {activeTitle}
                </h2>
                <p>Carter asks first, then hunts.</p>
              </div>
              {!isMobile ? (
                <button
                  type="button"
                  className={`icon-btn context-toggle${contextOpen ? " is-active" : ""}`}
                  onClick={toggleContextPanel}
                  aria-pressed={contextOpen}
                  aria-controls="context-panel"
                  aria-label={
                    contextOpen ? "Hide context panel" : "Show context panel"
                  }
                  title={contextOpen ? "Hide context" : "Show context"}
                >
                  <IconPanel />
                </button>
              ) : null}
            </div>
            <div
              className="messages"
              role="log"
              aria-live="polite"
              ref={messagesRef}
              onScroll={onMessagesScroll}
            >
              {(messages ?? []).length === 0 ? (
                <ChatIntro />
              ) : (
                (messages ?? []).map((message) => (
                  <MessageBubble
                    key={message.key}
                    message={message}
                    findingsByUrl={findingsByUrl}
                    rejectedUrls={rejectedUrls}
                    replyInteractive={
                      message.key === interactiveReplyMessageKey
                    }
                    replySelections={replySelections}
                    onToggleReply={onToggleReply}
                    storeInteractive={
                      message.key === interactiveStoreMessageKey
                    }
                    selectedStoreDomains={selectedStoreDomains}
                    storeBusy={storeActionBusy}
                    onToggleStoreDomain={onToggleStoreDomain}
                    onAddStores={() => void onAddStores()}
                    onSkipStores={() => void onSkipStores()}
                    onSetVerdict={onSetVerdict}
                    highlighted={message.key === highlightedMessageKey}
                  />
                ))
              )}
            </div>
            <div className="chat-compose-stack">
              {isMobile ? (
                <button
                  type="button"
                  className={`context-summary-bar${contextOpen ? " is-open" : ""}`}
                  onClick={toggleContextPanel}
                  aria-controls="context-panel"
                  aria-expanded={contextOpen}
                  aria-label={`Shopping context: ${contextSummary}`}
                >
                  <span className="context-summary-bar-text">
                    {contextSummary}
                  </span>
                  <span className="context-summary-bar-hint" aria-hidden="true">
                    ⋯
                  </span>
                </button>
              ) : null}
              <form className="composer" onSubmit={onSend}>
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={composerPlaceholder}
                  aria-label="Message Carter"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void onSend(event);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="composer-send"
                  disabled={!sessionId || sending || !draft.trim()}
                  aria-label={sending ? "Sending…" : "Send"}
                >
                  <IconSend />
                </button>
              </form>
            </div>
          </section>

          {!isMobile ? contextPanel : null}
        </div>

        {isMobile && contextOpen ? (
          <button
            type="button"
            className={`context-backdrop${contextLeaving ? " is-leaving" : ""}`}
            aria-label="Close context"
            onClick={closeContextPanel}
          />
        ) : null}
        {isMobile ? contextPanel : null}
      </div>
    </AppShell>
  );
}
