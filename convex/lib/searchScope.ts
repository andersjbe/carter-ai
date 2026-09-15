/** Marketplace sources stored on openQueries. */
export type MarketplaceSource = "amazon" | "etsy" | "web";

/** Max custom domains stored per open query. */
export const MAX_CUSTOM_DOMAINS = 8;

export type SearchPass = {
  /** Hostnames for Firecrawl includeDomains; omit for open web. */
  includeDomains?: string[];
  /** Optional site: bias when a single marketplace domain is used. */
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
 * Resolve stored sources + custom domains into one or two Firecrawl search passes.
 * - No restricted domains → single open search
 * - Restricted only → one includeDomains search (siteBias when exactly one domain)
 * - Restricted + web → restricted pass + open pass
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
  const wantOpenWeb = src.includes("web");
  const restricted = [...marketplaceDomains(src), ...custom];

  // Dedupe restricted hosts while preserving order
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const d of restricted) {
    if (seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }

  if (domains.length === 0) {
    return [{}];
  }

  const restrictedPass: SearchPass = {
    includeDomains: domains,
    siteBias: domains.length === 1 ? domains[0] : undefined,
  };

  if (wantOpenWeb) {
    return [restrictedPass, {}];
  }
  return [restrictedPass];
}

/** Split a total result limit across N search passes (ceil for first). */
export function splitSearchLimit(
  total: number | undefined,
  passCount: number,
): number[] {
  const n = Math.max(1, passCount);
  const base = total ?? 6;
  if (n === 1) return [base];
  const first = Math.ceil(base / n);
  const rest = Math.max(1, Math.floor(base / n));
  const limits: number[] = [first];
  for (let i = 1; i < n; i++) limits.push(rest);
  return limits;
}

/** Apply optional site: bias to a search query string. */
export function applySiteBias(query: string, siteBias?: string): string {
  if (!siteBias) return query;
  return `${query} site:${siteBias}`;
}
