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

function MessageBubble({ message }: { message: UIMessage }) {
  const [text] = useSmoothText(message.text ?? "", {
    startStreaming: message.status === "streaming",
  });
  const role = message.role === "user" ? "user" : "assistant";
  return (
    <article className={`message ${role}`}>
      <div className="meta">{role === "user" ? "You" : "Carter"}</div>
      <div className="body">{text || (message.status === "streaming" ? "…" : "")}</div>
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
                <MessageBubble key={message.key} message={message} />
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
                  <article className="finding-card" key={finding._id}>
                    <strong>
                      <a href={finding.url} target="_blank" rel="noreferrer">
                        {finding.title}
                      </a>
                    </strong>
                    <p>
                      {finding.source}
                      {finding.price != null
                        ? ` · ${finding.currency ?? "USD"} ${finding.price}`
                        : ""}
                    </p>
                    {finding.summary ? <p>{finding.summary}</p> : null}
                    {finding.isNew ? <span className="badge">New</span> : null}
                  </article>
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
