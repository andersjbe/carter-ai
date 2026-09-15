import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { IconX } from "./icons";

export type MarketplaceSource = "amazon" | "etsy" | "web";

const MARKETPLACE_OPTIONS: Array<{
  id: MarketplaceSource;
  label: string;
}> = [
  { id: "amazon", label: "Amazon" },
  { id: "etsy", label: "Etsy" },
  { id: "web", label: "Open web" },
];

export function SearchScopeEditor({
  sources,
  customDomains,
  disabled = false,
  label = "Search",
  onChange,
}: {
  sources: MarketplaceSource[];
  customDomains: string[];
  disabled?: boolean;
  label?: string;
  onChange: (
    sources: MarketplaceSource[],
    customDomains: string[],
  ) => void | Promise<void>;
}) {
  const [domainDraft, setDomainDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(
    nextSources: MarketplaceSource[],
    nextDomains: string[],
  ) {
    if (nextSources.length === 0 && nextDomains.length === 0) {
      setError("Pick a marketplace or add a site");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onChange(nextSources, nextDomains);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update sources",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleSource(id: MarketplaceSource) {
    const next = sources.includes(id)
      ? sources.filter((s) => s !== id)
      : [...sources, id];
    void persist(next, customDomains);
  }

  function removeDomain(host: string) {
    void persist(
      sources,
      customDomains.filter((d) => d !== host),
    );
  }

  function addDomain() {
    const raw = domainDraft.trim();
    if (!raw) return;
    setDomainDraft("");
    void persist(sources, [...customDomains, raw]);
  }

  const busy = disabled || saving;

  return (
    <div className="query-scope">
      {label ? <span className="query-scope-label">{label}</span> : null}
      <div
        className="query-scope-toggles"
        role="group"
        aria-label="Marketplaces"
      >
        {MARKETPLACE_OPTIONS.map((opt) => {
          const on = sources.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={
                on
                  ? "query-scope-toggle query-scope-toggle--on"
                  : "query-scope-toggle"
              }
              aria-pressed={on}
              disabled={busy}
              onClick={() => toggleSource(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {customDomains.length > 0 ? (
        <div className="query-domain-chips">
          {customDomains.map((host) => (
            <span key={host} className="query-domain-chip">
              {host}
              <button
                type="button"
                className="query-domain-remove"
                aria-label={`Remove ${host}`}
                disabled={busy}
                onClick={() => removeDomain(host)}
              >
                <IconX />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="query-domain-add">
        <input
          type="text"
          value={domainDraft}
          disabled={busy}
          placeholder="Add site (e.g. wayfair.com)"
          aria-label="Add custom domain"
          onChange={(event) => setDomainDraft(event.target.value)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDomain();
            }
          }}
        />
        <button
          type="button"
          className="query-domain-add-btn"
          disabled={busy || !domainDraft.trim()}
          onClick={addDomain}
        >
          Add
        </button>
      </div>
      {error ? <p className="query-scope-error">{error}</p> : null}
    </div>
  );
}
