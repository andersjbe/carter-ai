/** Marketplace sources stored on openQueries. */
export type MarketplaceSource = "amazon" | "etsy" | "web";

/** Max custom domains stored per open query. */
export const MAX_CUSTOM_DOMAINS = 8;

export type SearchPass = {
  /** Hostnames for Firecrawl includeDomains (required for product search). */
  includeDomains: string[];
  /** site: bias — always set for per-domain passes. */
  siteBias?: string;
};

const HOSTNAME_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Normalize user/agent input to a bare hostname (no protocol, www, path).
 * Returns null when the value is not a usable hostname.
 */
export function normalizeHostname(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    if (candidate.includes("://")) {
      candidate = new URL(candidate).hostname;
    } else if (candidate.includes("/") || candidate.includes("?")) {
      candidate = new URL(`https://${candidate}`).hostname;
    }
  } catch {
    return null;
  }

  candidate = candidate.replace(/^www\./, "").replace(/\.$/, "");
  if (!HOSTNAME_RE.test(candidate)) return null;
  return candidate;
}

/**
 * Normalize and dedupe custom domains; throws if any entry is invalid
 * or the list exceeds MAX_CUSTOM_DOMAINS.
 */
export function normalizeCustomDomains(inputs: string[]): string[] {
  if (inputs.length > MAX_CUSTOM_DOMAINS) {
    throw new Error(
      `At most ${MAX_CUSTOM_DOMAINS} custom domains allowed`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of inputs) {
    const host = normalizeHostname(raw);
    if (!host) {
      throw new Error(`Invalid domain: ${raw}`);
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function marketplaceDomains(
  sources: MarketplaceSource[],
): string[] {
  const domains: string[] = [];
  if (sources.includes("amazon")) domains.push("amazon.com");
  if (sources.includes("etsy")) domains.push("etsy.com");
  return domains;
}

/**
 * Resolve stored sources + custom domains into Firecrawl product-search passes.
 * - `"web"` does not open unrestricted search; it only means store discovery is allowed.
 * - One pass per host (Amazon / Etsy / each custom domain) with site: bias so
 *   smaller specialty stores are not drowned out by large marketplaces.
 * - Zero product hosts → empty array (caller should not search open web).
 */
export function resolveSearchScope(
  sources: MarketplaceSource[] | null | undefined,
  customDomains: string[] | null | undefined,
): SearchPass[] {
  // null/undefined → legacy default; [] means marketplaces off (custom-only ok).
  const src: MarketplaceSource[] =
    sources === null || sources === undefined
      ? ["amazon", "etsy", "web"]
      : sources;
  const custom = customDomains ?? [];
  const restricted = [...marketplaceDomains(src), ...custom];

  // Dedupe restricted hosts while preserving order
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const d of restricted) {
    if (seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }

  return domains.map((domain) => ({
    includeDomains: [domain],
    siteBias: domain,
  }));
}

/**
 * Split a total result limit across N search passes.
 * Each pass gets at least 1 when possible; remainder is spread round-robin.
 */
export function splitSearchLimit(
  total: number | undefined,
  passCount: number,
): number[] {
  const n = Math.max(1, passCount);
  const base = Math.max(1, total ?? 6);
  if (n === 1) return [base];

  const limits = Array.from({ length: n }, () => 1);
  let remaining = Math.max(0, base - n);
  let i = 0;
  while (remaining > 0) {
    limits[i % n]! += 1;
    remaining -= 1;
    i += 1;
  }
  return limits;
}

/** Apply optional site: bias to a search query string. */
export function applySiteBias(query: string, siteBias?: string): string {
  if (!siteBias) return query;
  const needle = `site:${siteBias}`;
  if (query.toLowerCase().includes(needle.toLowerCase())) return query;
  return `${query} ${needle}`;
}
