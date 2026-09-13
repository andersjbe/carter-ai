import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import ThemeToggle from "../components/ThemeToggle";

type ContextTab = "knows" | "queries" | "findings";

function IconSidebar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconThumbsUp({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

type ProductCardData = {
  _id?: Id<"findings">;
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  source: string | null;
  summary: string | null;
  imageUrl: string | null;
  isNew?: boolean;
  verdict?: "accepted" | "rejected" | null;
};

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

function formatPrice(price: number | null, currency: string | null) {
  if (price == null) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${code} ${price}`;
  }
}

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

function ProductCard({
  product,
  onSetVerdict,
}: {
  product: ProductCardData;
  onSetVerdict?: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void;
}) {
  const priceLabel = formatPrice(product.price, product.currency);
  const isAccepted = product.verdict === "accepted";
  const canJudge = Boolean(product._id && onSetVerdict);

  return (
    <article
      className={`product-card${isAccepted ? " is-accepted" : ""}`}
    >
      <a
        className="product-card-media"
        href={product.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${product.title}`}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="product-card-placeholder" aria-hidden="true">
            No image
          </div>
        )}
      </a>
      <div className="product-card-body">
        <div className="product-card-meta">
          {product.source ? (
            <span className="product-source">{product.source}</span>
          ) : null}
          {product.isNew ? <span className="badge">New</span> : null}
          {isAccepted ? <span className="badge badge-liked">Liked</span> : null}
        </div>
        <strong>
          <a href={product.url} target="_blank" rel="noreferrer">
            {product.title}
          </a>
        </strong>
        {priceLabel ? <p className="product-price">{priceLabel}</p> : null}
        {product.summary ? (
          <p className="product-summary">{product.summary}</p>
        ) : null}
        {canJudge && product._id && onSetVerdict ? (
          <div className="product-verdict" role="group" aria-label="Rate product">
            <button
              type="button"
              className={`product-verdict-btn${isAccepted ? " is-selected" : ""}`}
              aria-label={isAccepted ? "Unlike" : "Like"}
              aria-pressed={isAccepted}
              title={isAccepted ? "Unlike" : "Like"}
              onClick={() =>
                onSetVerdict(product._id!, isAccepted ? null : "accepted")
              }
            >
              <IconThumbsUp />
            </button>
            {!isAccepted ? (
              <button
                type="button"
                className="product-verdict-btn product-verdict-btn-reject"
                aria-label="Reject"
                title="Reject"
                onClick={() => onSetVerdict(product._id!, "rejected")}
              >
                <IconX />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
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

function MessageBubble({
  message,
  findingsByUrl,
  rejectedUrls,
  replyInteractive,
  replySelections,
  onToggleReply,
  onSetVerdict,
}: {
  message: UIMessage;
  findingsByUrl: Map<string, ProductCardData>;
  rejectedUrls: Set<string>;
  replyInteractive: boolean;
  replySelections: Record<string, ReplySelection>;
  onToggleReply: (question: ReplyQuestion, option: string | null) => void;
  onSetVerdict: (
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) => void;
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
    () => (replyInteractive ? extractReplyChoicesFromMessage(message) : []),
    [message, replyInteractive],
  );

  return (
    <article className={`message ${role}`}>
      <div className="meta">{role === "user" ? "You" : "Carter"}</div>
      <div className="body">
        {text || (message.status === "streaming" ? "…" : "")}
      </div>
      {products.length > 0 ? (
        <div className="product-grid" aria-label="Product recommendations">
          {products.map((product) => (
            <ProductCard
              key={product.url}
              product={product}
              onSetVerdict={onSetVerdict}
            />
          ))}
        </div>
      ) : null}
      {replyChoices.length > 0 ? (
        <ReplyChoices
          questions={replyChoices}
          selections={replySelections}
          interactive={replyInteractive}
          onToggle={onToggleReply}
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

export default function ChatApp() {
  const navigate = useNavigate();
  const { data: authSession } = authClient.useSession();
  const ensureSession = useMutation(api.sessions.getOrCreate);
  const createSession = useMutation(api.sessions.create);
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
  const [threadSearch, setThreadSearch] = useState("");
  const [contextTab, setContextTab] = useState<ContextTab>("knows");
  const [draft, setDraft] = useState("");
  const [replySelections, setReplySelections] = useState<
    Record<string, ReplySelection>
  >({});
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [email, setEmail] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const activeTitle =
    conversations?.find((row) => row.sessionId === sessionId)?.title ??
    "New chat";

  const filteredConversations = useMemo(() => {
    const rows = conversations ?? [];
    const q = threadSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.title.toLowerCase().includes(q));
  }, [conversations, threadSearch]);

  function selectConversation(
    nextSessionId: Id<"sessions">,
    nextThreadId: string,
  ) {
    setSessionId(nextSessionId);
    setThreadId(nextThreadId);
    setDraft("");
    setReplySelections({});
    const userId = authSession?.user?.id;
    if (userId) storeActiveSessionId(userId, nextSessionId);
    if (
      threadsOpen &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
    ) {
      setThreadsOpen(false);
      storeThreadsSidebarOpen(false);
    }
  }

  function toggleThreadsSidebar() {
    setThreadsOpen((open) => {
      const next = !open;
      storeThreadsSidebarOpen(next);
      return next;
    });
  }

  function openSidebarForSearch() {
    if (!threadsOpen) {
      setThreadsOpen(true);
      storeThreadsSidebarOpen(true);
    }
    queueMicrotask(() => searchInputRef.current?.focus());
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      navigate("/", { replace: true });
    } finally {
      setSigningOut(false);
    }
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
  const alertPrefs = useQuery(
    api.mail.getPrefs,
    sessionId ? { sessionId } : "skip",
  );

  useEffect(() => {
    setEmail(alertPrefs?.email ?? profile?.email ?? "");
    setAlertsEnabled(alertPrefs?.enabled ?? false);
  }, [alertPrefs, profile?.email, sessionId]);

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

  const interactiveReplyQuestions = useMemo(() => {
    if (!interactiveReplyMessageKey) return [] as ReplyQuestion[];
    const message = (messages ?? []).find(
      (row) => row.key === interactiveReplyMessageKey,
    );
    return message ? extractReplyChoicesFromMessage(message) : [];
  }, [messages, interactiveReplyMessageKey]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sessionId]);

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
  const setAlerts = useMutation(api.mail.setAlerts);
  const setVerdict = useMutation(api.findings.setVerdict);

  async function onSetVerdict(
    findingId: Id<"findings">,
    verdict: "accepted" | "rejected" | null,
  ) {
    try {
      await setVerdict({ findingId, verdict });
    } catch (error) {
      console.error("Failed to set finding verdict", error);
    }
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
    const prompt = draft.trim();
    setDraft("");
    setReplySelections({});
    try {
      await sendMessage({ sessionId, threadId, prompt });
    } finally {
      setSending(false);
    }
  }

  async function onSaveAlerts(event: FormEvent) {
    event.preventDefault();
    if (!sessionId) return;
    setAlertBusy(true);
    try {
      await setAlerts({
        sessionId,
        enabled: alertsEnabled,
        email: email || undefined,
      });
    } finally {
      setAlertBusy(false);
    }
  }

  const prefChips = useMemo(() => {
    const prefs = profile?.prefs;
    if (!prefs) return [] as string[];
    const chips: string[] = [];
    if (prefs.budgetMax != null) {
      chips.push(
        prefs.budgetMin != null
          ? `$${prefs.budgetMin}–$${prefs.budgetMax}`
          : `up to $${prefs.budgetMax}`,
      );
    }
    for (const item of prefs.categories ?? []) chips.push(item);
    for (const item of prefs.styles ?? []) chips.push(item);
    for (const item of prefs.useCases ?? []) chips.push(item);
    for (const item of prefs.constraints ?? []) chips.push(item);
    return chips.slice(0, 12);
  }, [profile]);

  return (
    <div className="app-shell app-shell--chat">
      <header className="app-topbar">
        <h1 className="app-topbar-brand">Carter</h1>
        <div className="app-topbar-actions">
          {authSession?.user?.email ? (
            <span className="account-email">{authSession.user.email}</span>
          ) : null}
          <ThemeToggle />
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => void onSignOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <div
        className={`workspace${threadsOpen ? " workspace--threads" : " workspace--rail"}`}
      >
        {threadsOpen ? (
          <button
            type="button"
            className="threads-backdrop"
            aria-label="Close chat sidebar"
            onClick={toggleThreadsSidebar}
          />
        ) : null}

        <aside
          id="threads-sidebar"
          className={`panel threads-sidebar${threadsOpen ? " is-open" : " is-collapsed"}`}
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
                    {threadSearch.trim()
                      ? "No matching threads"
                      : "No chats yet"}
                  </li>
                ) : (
                  filteredConversations.map((row) => {
                    const active = row.sessionId === sessionId;
                    return (
                      <li key={row.sessionId}>
                        <button
                          type="button"
                          className={`thread-item${active ? " is-active" : ""}`}
                          onClick={() =>
                            selectConversation(row.sessionId, row.threadId)
                          }
                          aria-current={active ? "true" : undefined}
                        >
                          <span className="thread-item-title">{row.title}</span>
                        </button>
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
                <h2>{activeTitle}</h2>
                <p>Carter asks first, then hunts.</p>
              </div>
            </div>
            <div
              className="messages"
              role="log"
              aria-live="polite"
              ref={messagesRef}
            >
              {(messages ?? []).length === 0 ? (
                <p className="empty">
                  Say hello, or tell Carter what you are shopping for. Expect a
                  few curious questions before any search.
                </p>
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
                    onSetVerdict={onSetVerdict}
                  />
                ))
              )}
            </div>
            <form className="composer" onSubmit={onSend}>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="I need a compact desk lamp for late-night reading…"
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
                disabled={!sessionId || sending || !draft.trim()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          </section>

          <aside className="panel context-panel" aria-label="Shopping context">
            <div className="context-tabs" role="tablist" aria-label="Context">
              {(
                [
                  ["knows", "Knows"],
                  ["queries", "Queries"],
                  ["findings", "Findings"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`context-tab-${id}`}
                  aria-selected={contextTab === id}
                  aria-controls={`context-panel-${id}`}
                  className={`context-tab${contextTab === id ? " is-active" : ""}`}
                  onClick={() => setContextTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="context-tab-body">
              {contextTab === "knows" ? (
                <div
                  id="context-panel-knows"
                  role="tabpanel"
                  aria-labelledby="context-tab-knows"
                  className="context-pane"
                >
                  <section className="side-panel context-section">
                    <h3>What Carter knows</h3>
                    <p className="hint">
                      {profile?.summary ??
                        "Preferences appear here as Carter learns your taste."}
                    </p>
                    <div className="chips">
                      {prefChips.length === 0 ? (
                        <span className="empty">No preferences yet</span>
                      ) : (
                        prefChips.map((chip) => (
                          <span className="chip" key={chip}>
                            {chip}
                          </span>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="alerts context-section">
                    <h3>Email alerts</h3>
                    <p className="hint">
                      AgentMail can email you when Carter spots new products or
                      sales for your open queries.
                    </p>
                    <form onSubmit={onSaveAlerts}>
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        aria-label="Alert email"
                      />
                      <label>
                        <input
                          type="checkbox"
                          checked={alertsEnabled}
                          onChange={(event) =>
                            setAlertsEnabled(event.target.checked)
                          }
                        />
                        Send me new-find digests
                      </label>
                      <button type="submit" disabled={!sessionId || alertBusy}>
                        {alertBusy ? "Saving…" : "Save alerts"}
                      </button>
                    </form>
                  </section>
                </div>
              ) : null}

              {contextTab === "queries" ? (
                <div
                  id="context-panel-queries"
                  role="tabpanel"
                  aria-labelledby="context-tab-queries"
                  className="context-pane"
                >
                  <section className="side-panel context-section">
                    <h3>Open queries</h3>
                    <p className="hint">
                      Live shopping briefs Carter is watching.
                    </p>
                    <div className="query-list">
                      {(openQueries ?? []).length === 0 ? (
                        <p className="empty">No open queries yet.</p>
                      ) : (
                        (openQueries ?? []).map((query) => (
                          <div className="query-card" key={query._id}>
                            <strong>{query.title}</strong>
                            <p>{query.brief}</p>
                            <span className="badge">{query.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : null}

              {contextTab === "findings" ? (
                <div
                  id="context-panel-findings"
                  role="tabpanel"
                  aria-labelledby="context-tab-findings"
                  className="context-pane"
                >
                  <section className="side-panel context-section">
                    <h3>Findings</h3>
                    <p className="hint">
                      Products Carter found. Like to keep, Pass to hide.
                    </p>
                    <div className="finding-list">
                      {(findings ?? []).length === 0 ? (
                        <p className="empty">Nothing found yet.</p>
                      ) : (
                        (findings ?? []).map((finding) => (
                          <ProductCard
                            key={finding._id}
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
                          />
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
