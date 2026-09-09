import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const CLIENT_KEY = "carter_client_key";

type ProductCardData = {
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  source: string | null;
  summary: string | null;
  imageUrl: string | null;
  isNew?: boolean;
};

function getClientKey() {
  const existing = localStorage.getItem(CLIENT_KEY);
  if (existing) return existing;
  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `carter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CLIENT_KEY, next);
  return next;
}

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
      const fromFinding = findingsByUrl.get(key);
      byUrl.set(key, {
        ...product,
        price: product.price ?? fromFinding?.price ?? null,
        currency: product.currency ?? fromFinding?.currency ?? null,
        source: product.source ?? fromFinding?.source ?? null,
        summary: product.summary ?? fromFinding?.summary ?? null,
        imageUrl: product.imageUrl ?? fromFinding?.imageUrl ?? null,
        isNew: fromFinding?.isNew,
      });
    }
  }

  return Array.from(byUrl.values());
}

function ProductCard({ product }: { product: ProductCardData }) {
  const priceLabel = formatPrice(product.price, product.currency);
  return (
    <article className="product-card">
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
      </div>
    </article>
  );
}

function MessageBubble({
  message,
  findingsByUrl,
}: {
  message: UIMessage;
  findingsByUrl: Map<string, ProductCardData>;
}) {
  const [text] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });
  const role = message.role === "user" ? "user" : "assistant";
  const products = useMemo(
    () => extractProductsFromMessage(message, findingsByUrl),
    [message, findingsByUrl],
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
            <ProductCard key={product.url} product={product} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function App() {
  const clientKey = useMemo(() => getClientKey(), []);
  const ensureSession = useMutation(api.sessions.getOrCreate);
  const [sessionId, setSessionId] = useState<Id<"sessions"> | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ensureSession({ clientKey }).then((session) => {
      if (cancelled) return;
      setSessionId(session.sessionId);
      setThreadId(session.threadId);
    });
    return () => {
      cancelled = true;
    };
  }, [clientKey, ensureSession]);

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
  const alertPrefs = useQuery(
    api.mail.getPrefs,
    sessionId ? { sessionId } : "skip",
  );

  useEffect(() => {
    if (alertPrefs?.email) setEmail(alertPrefs.email);
    if (alertPrefs) setAlertsEnabled(alertPrefs.enabled);
  }, [alertPrefs]);

  useEffect(() => {
    if (profile?.email) setEmail(profile.email);
  }, [profile?.email]);

  const { results: messages } = useUIMessages(
    api.chat.listMessages,
    sessionId && threadId ? { threadId, sessionId } : "skip",
    { initialNumItems: 40, stream: true },
  );

  const findingsByUrl = useMemo(() => {
    const map = new Map<string, ProductCardData>();
    for (const finding of findings ?? []) {
      map.set(normalizeUrlKey(finding.url), {
        title: finding.title,
        url: finding.url,
        price: finding.price,
        currency: finding.currency,
        source: finding.source,
        summary: finding.summary,
        imageUrl: finding.imageUrl,
        isNew: finding.isNew,
      });
    }
    return map;
  }, [findings]);

  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    (store, args) => {
      optimisticallySendMessage(api.chat.listMessages)(store, {
        threadId: args.threadId,
        prompt: args.prompt,
      });
    },
  );
  const setAlerts = useMutation(api.mail.setAlerts);

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !threadId || !draft.trim() || sending) return;
    setSending(true);
    const prompt = draft.trim();
    setDraft("");
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
    <div className="app-shell">
      <header className="hero">
        <h1 className="brand">Carter</h1>
        <p className="tagline">
          A curious product scout that learns what you want before searching
          Amazon, Etsy, and the web — then watches for new finds.
        </p>
      </header>

      <div className="layout">
        <section className="panel chat-panel" aria-label="Chat with Carter">
          <div className="chat-header">
            <h2>Talk it through</h2>
            <p>Carter asks first, then hunts.</p>
          </div>
          <div className="messages" role="log" aria-live="polite">
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
                />
              ))
            )}
          </div>
          <form className="composer" onSubmit={onSend}>
            <textarea
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
            <button type="submit" disabled={!sessionId || sending || !draft.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        </section>

        <aside className="side-stack">
          <section className="panel side-panel">
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

          <section className="panel side-panel">
            <h3>Open queries</h3>
            <p className="hint">Live shopping briefs Carter is watching.</p>
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

          <section className="panel side-panel">
            <h3>Findings</h3>
            <p className="hint">Products pulled in through Firecrawl.</p>
            <div className="finding-list">
              {(findings ?? []).length === 0 ? (
                <p className="empty">Nothing found yet.</p>
              ) : (
                (findings ?? []).map((finding) => (
                  <ProductCard
                    key={finding._id}
                    product={{
                      title: finding.title,
                      url: finding.url,
                      price: finding.price,
                      currency: finding.currency,
                      source: finding.source,
                      summary: finding.summary,
                      imageUrl: finding.imageUrl,
                      isNew: finding.isNew,
                    }}
                  />
                ))
              )}
            </div>
          </section>

          <section className="panel alerts">
            <h3>Email alerts</h3>
            <p className="hint">
              AgentMail can email you when Carter spots new products or sales
              for your open queries.
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
                  onChange={(event) => setAlertsEnabled(event.target.checked)}
                />
                Send me new-find digests
              </label>
              <button type="submit" disabled={!sessionId || alertBusy}>
                {alertBusy ? "Saving…" : "Save alerts"}
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
