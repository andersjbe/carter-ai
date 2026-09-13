import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { internalAction, type ActionCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const firecrawl = new FirecrawlClient(components.firecrawl);

/** Max Firecrawl detail scrapes after a search (credits). */
const MAX_FIRECRAWL_ENRICH_PER_SEARCH = 3;

const findingResultValidator = v.object({
  title: v.string(),
  url: v.string(),
  source: v.union(
    v.literal("amazon"),
    v.literal("etsy"),
    v.literal("web"),
  ),
  summary: v.union(v.string(), v.null()),
  price: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
});

type FindingResult = {
  title: string;
  url: string;
  source: "amazon" | "etsy" | "web";
  summary: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
};

function detectSource(url: string): "amazon" | "etsy" | "web" {
  const lower = url.toLowerCase();
  if (lower.includes("amazon.") || lower.includes("amzn.")) return "amazon";
  if (lower.includes("etsy.")) return "etsy";
  return "web";
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** True when the URL looks like a product detail page, not a search/category SERP. */
function isProductPageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const params = parsed.searchParams;

  const isAmazon =
    host.includes("amazon.") ||
    host.includes("amzn.") ||
    host === "a.co" ||
    host.endsWith(".a.co");
  if (isAmazon) {
    return (
      /\/dp\/[a-z0-9]{8,}/i.test(path) ||
      /\/gp\/product\/[a-z0-9]{8,}/i.test(path) ||
      /\/gp\/aw\/d\/[a-z0-9]{8,}/i.test(path)
    );
  }

  if (host.includes("etsy.")) {
    return /\/listing\/\d+/i.test(path);
  }

  // Other web: allow unless the path/query clearly looks like a search page.
  if (
    path === "/s" ||
    path.startsWith("/s/") ||
    path.includes("/search") ||
    path.includes("/sch") ||
    path.startsWith("/slp/") ||
    path.startsWith("/c/") ||
    path.startsWith("/market/") ||
    params.has("q") ||
    params.has("k") ||
    params.has("query") ||
    params.has("keyword") ||
    params.has("keywords")
  ) {
    return false;
  }

  return true;
}

function parsePrice(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return undefined;
  }
  // Skip tiny tracking pixels / icons when possible
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("favicon") ||
    lower.includes("sprite") ||
    lower.endsWith(".svg")
  ) {
    return undefined;
  }
  return trimmed;
}

function imageFromMarkdown(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
  return asHttpUrl(match?.[1]);
}

function imageFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  return (
    asHttpUrl(metadata.ogImage) ??
    asHttpUrl(metadata["og:image"]) ??
    asHttpUrl(metadata.image) ??
    asHttpUrl(metadata.twitterImage) ??
    asHttpUrl(metadata["twitter:image"])
  );
}

function imageFromProduct(product: unknown): string | undefined {
  if (!product || typeof product !== "object") return undefined;
  const root = product as {
    image?: unknown;
    imageUrl?: unknown;
    images?: unknown;
    variants?: unknown;
  };
  const direct =
    asHttpUrl(root.imageUrl) ??
    asHttpUrl(root.image) ??
    (Array.isArray(root.images)
      ? asHttpUrl(
          typeof root.images[0] === "string"
            ? root.images[0]
            : (root.images[0] as { url?: unknown } | undefined)?.url,
        )
      : undefined);
  if (direct) return direct;

  if (!Array.isArray(root.variants)) return undefined;
  for (const variant of root.variants) {
    if (!variant || typeof variant !== "object") continue;
    const images = (variant as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) continue;
    const first = images[0];
    const url =
      typeof first === "string"
        ? asHttpUrl(first)
        : asHttpUrl((first as { url?: unknown })?.url);
    if (url) return url;
  }
  return undefined;
}

function extractImageUrl(hit: Record<string, unknown>): string | undefined {
  const metadata =
    hit.metadata && typeof hit.metadata === "object"
      ? (hit.metadata as Record<string, unknown>)
      : undefined;

  const images = hit.images;
  const firstListedImage = Array.isArray(images)
    ? asHttpUrl(
        typeof images[0] === "string"
          ? images[0]
          : (images[0] as { url?: unknown } | undefined)?.url,
      )
    : undefined;

  return (
    imageFromProduct(hit.product) ??
    asHttpUrl(hit.imageUrl) ??
    asHttpUrl(hit.image) ??
    firstListedImage ??
    imageFromMetadata(metadata) ??
    imageFromMarkdown(
      typeof hit.markdown === "string"
        ? hit.markdown
        : typeof hit.description === "string"
          ? hit.description
          : typeof hit.summary === "string"
            ? hit.summary
            : undefined,
    )
  );
}

function extractSearchHits(
  response: unknown,
): Array<Record<string, unknown>> {
  if (!response || typeof response !== "object") return [];

  const root = response as Record<string, unknown>;

  // Typed SearchResponse from @firecrawl/firecrawl-convex
  const direct =
    (Array.isArray(root.web) ? root.web : null) ??
    (Array.isArray(root.news) ? root.news : null) ??
    (Array.isArray(root.images) ? root.images : null);

  if (direct) return direct as Array<Record<string, unknown>>;

  // Raw API envelope fallback: { data: { web: [...] } } or { data: [...] }
  const data = root.data;
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (Array.isArray(nested.web)) {
      return nested.web as Array<Record<string, unknown>>;
    }
    if (Array.isArray(nested.news)) {
      return nested.news as Array<Record<string, unknown>>;
    }
  }

  // Last resort: response itself is an array of hits
  if (Array.isArray(response)) {
    return response as Array<Record<string, unknown>>;
  }

  return [];
}

function priceFromProduct(product: unknown): number | undefined {
  if (!product || typeof product !== "object") return undefined;
  const root = product as {
    price?: unknown;
    variants?: unknown;
  };
  if (typeof root.price === "number") return root.price;
  if (typeof root.price === "string") return parsePrice(root.price);
  if (!Array.isArray(root.variants) || root.variants.length === 0) {
    return undefined;
  }
  const variant = root.variants[0] as { price?: unknown };
  if (typeof variant.price === "number") return variant.price;
  if (typeof variant.price === "string") return parsePrice(variant.price);
  return undefined;
}

function metaContent(html: string, property: string): string | undefined {
  const propRe = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return propRe.exec(html)?.[1] ?? contentFirst.exec(html)?.[1];
}

/**
 * Free enrichment for open-web pages (no Firecrawl credits).
 * Skips Amazon/Etsy — they usually block plain fetch.
 */
async function tryFreeEnrich(url: string): Promise<{
  title?: string;
  summary?: string;
  price?: number;
  imageUrl?: string;
} | null> {
  const source = detectSource(url);
  if (source === "amazon" || source === "etsy") return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const markdown = (await response.text()).slice(0, 12_000);
    if (!markdown.trim()) return null;

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim().slice(0, 200);
    const summary = markdown
      .replace(/^#\s+.+$/m, "")
      .replace(/!\[[^\]]*]\([^)]+\)/g, "")
      .trim()
      .slice(0, 500);
    return {
      title: title || undefined,
      summary: summary || undefined,
      price: parsePrice(markdown),
      imageUrl: imageFromMarkdown(markdown),
    };
  } catch {
    // Fall through to plain HTML fetch
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CarterBot/1.0; +https://carter.local)",
        Accept: "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 200_000);
    const title =
      metaContent(html, "og:title") ??
      /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
    const description =
      metaContent(html, "og:description") ??
      metaContent(html, "description");
    const imageUrl = asHttpUrl(metaContent(html, "og:image"));
    return {
      title: title?.slice(0, 200),
      summary: description?.slice(0, 500),
      price: parsePrice(description) ?? parsePrice(title),
      imageUrl,
    };
  } catch {
    return null;
  }
}

function findingFromPage(
  url: string,
  page: Record<string, unknown>,
): FindingResult {
  const metadata =
    page.metadata && typeof page.metadata === "object"
      ? (page.metadata as Record<string, unknown>)
      : undefined;
  const product = page.product;

  const title = String(
    (product &&
    typeof product === "object" &&
    typeof (product as { title?: unknown }).title === "string"
      ? (product as { title: string }).title
      : null) ??
      metadata?.title ??
      url,
  ).slice(0, 200);

  const summary =
    typeof page.summary === "string"
      ? page.summary
      : product &&
          typeof product === "object" &&
          typeof (product as { description?: unknown }).description === "string"
        ? String((product as { description: string }).description).slice(0, 500)
        : typeof page.markdown === "string"
          ? String(page.markdown).slice(0, 500)
          : null;

  const price =
    priceFromProduct(product) ?? parsePrice(summary ?? undefined);
  const currency = price !== undefined ? "USD" : undefined;
  const source = detectSource(url);
  const imageUrl = extractImageUrl(page);

  return {
    title,
    url,
    source,
    summary,
    price: price ?? null,
    currency: currency ?? null,
    imageUrl: imageUrl ?? null,
  };
}

async function firecrawlScrapeLean(
  ctx: ActionCtx,
  url: string,
): Promise<FindingResult> {
  const page = await firecrawl.scrape(ctx, url, {
    formats: ["markdown", "images", "product"],
    onlyMainContent: true,
  });
  return findingFromPage(url, page as Record<string, unknown>);
}

export const searchAndStore = internalAction({
  args: {
    sessionId: v.id("sessions"),
    queryId: v.id("openQueries"),
    searchQuery: v.string(),
    includeDomains: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    /** When false, skip detail enrich (digest rechecks). Default true. */
    enrichNew: v.optional(v.boolean()),
  },
  returns: v.object({
    stored: v.number(),
    created: v.number(),
    results: v.array(findingResultValidator),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 6, 10);
    // Small buffer so product-URL filtering still fills `limit` without
    // doubling billed search results.
    const fetchLimit = Math.min(limit + 2, 10);
    const shouldEnrich = args.enrichNew !== false;

    // Search only — no scrapeOptions (avoids +1 credit per result).
    const response = await firecrawl.search(ctx, args.searchQuery, {
      limit: fetchLimit,
      includeDomains: args.includeDomains,
    });

    const hits = extractSearchHits(response);
    const knownKeys = new Set(
      await ctx.runQuery(internal.findings.listUrlKeysForQuery, {
        queryId: args.queryId,
      }),
    );
    const rejectedKeys = new Set(
      await ctx.runQuery(internal.findings.listRejectedUrlKeysForSession, {
        sessionId: args.sessionId,
      }),
    );

    let stored = 0;
    let created = 0;
    let firecrawlEnrichs = 0;
    const results: FindingResult[] = [];

    for (const hit of hits) {
      if (results.length >= limit) break;

      const url = String(hit.url ?? hit.sourceURL ?? "").trim();
      if (!url || !isProductPageUrl(url)) continue;

      const urlKey = normalizeUrlKey(url);
      if (knownKeys.has(urlKey) || rejectedKeys.has(urlKey)) continue;

      const metadata =
        hit.metadata && typeof hit.metadata === "object"
          ? (hit.metadata as { title?: string; description?: string })
          : undefined;
      let title = String(hit.title ?? metadata?.title ?? url).slice(0, 200);
      const source = detectSource(url);
      let summary =
        typeof hit.description === "string"
          ? hit.description
          : typeof metadata?.description === "string"
            ? metadata.description
            : null;
      let price =
        parsePrice(summary ?? undefined) ?? parsePrice(title) ?? undefined;
      let imageUrl = extractImageUrl(hit);
      let currency: string | undefined = price !== undefined ? "USD" : undefined;

      // Enrich new product pages: free path for open web, lean Firecrawl for
      // marketplaces / when free enrich fails — capped per search.
      if (shouldEnrich) {
        const needsDetail = price === undefined || !imageUrl;
        if (needsDetail) {
          let enriched = false;
          if (source === "web") {
            const free = await tryFreeEnrich(url);
            if (free) {
              if (free.title) title = free.title;
              if (free.summary) summary = free.summary;
              if (free.price !== undefined) {
                price = free.price;
                currency = "USD";
              }
              if (free.imageUrl) imageUrl = free.imageUrl;
              enriched = free.price !== undefined || Boolean(free.imageUrl);
            }
          }

          if (
            !enriched &&
            firecrawlEnrichs < MAX_FIRECRAWL_ENRICH_PER_SEARCH &&
            (source !== "web" || needsDetail)
          ) {
            try {
              const detail = await firecrawlScrapeLean(ctx, url);
              title = detail.title || title;
              summary = detail.summary ?? summary;
              if (detail.price != null) {
                price = detail.price;
                currency = detail.currency ?? "USD";
              }
              if (detail.imageUrl) imageUrl = detail.imageUrl;
              firecrawlEnrichs += 1;
            } catch (error) {
              console.error("Firecrawl enrich failed", url, error);
            }
          }
        }
      }

      const upserted = await ctx.runMutation(internal.findings.upsertFinding, {
        queryId: args.queryId,
        sessionId: args.sessionId,
        title: title || url,
        url,
        price,
        currency,
        source,
        summary: summary ?? undefined,
        imageUrl: imageUrl ?? undefined,
      });
      knownKeys.add(urlKey);
      stored += 1;
      if (upserted.created) created += 1;
      results.push({
        title: title || url,
        url,
        source,
        summary,
        price: price ?? null,
        currency: price !== undefined ? (currency ?? "USD") : null,
        imageUrl: imageUrl ?? null,
      });
    }

    await ctx.runMutation(internal.openQueries.touchChecked, {
      queryId: args.queryId,
    });

    return { stored, created, results };
  },
});

export const scrapeProductPage = internalAction({
  args: {
    sessionId: v.id("sessions"),
    queryId: v.id("openQueries"),
    url: v.string(),
  },
  returns: findingResultValidator,
  handler: async (ctx, args) => {
    if (!isProductPageUrl(args.url)) {
      throw new Error(
        "URL must be a product detail page, not a search or category page",
      );
    }

    const source = detectSource(args.url);
    let result: FindingResult | null = null;

    // Prefer free enrich for open web; Firecrawl only when needed.
    if (source === "web") {
      const free = await tryFreeEnrich(args.url);
      if (free && (free.title || free.summary || free.price !== undefined)) {
        result = {
          title: (free.title ?? args.url).slice(0, 200),
          url: args.url,
          source,
          summary: free.summary ?? null,
          price: free.price ?? null,
          currency: free.price !== undefined ? "USD" : null,
          imageUrl: free.imageUrl ?? null,
        };
      }
    }

    if (!result) {
      result = await firecrawlScrapeLean(ctx, args.url);
    }

    await ctx.runMutation(internal.findings.upsertFinding, {
      queryId: args.queryId as Id<"openQueries">,
      sessionId: args.sessionId,
      title: result.title,
      url: args.url,
      price: result.price ?? undefined,
      currency: result.currency ?? undefined,
      source: result.source,
      summary: result.summary ?? undefined,
      imageUrl: result.imageUrl ?? undefined,
    });

    return result;
  },
});

/** Scrape a product URL for price checks (shopping list digests). No DB writes. */
export const scrapePriceOnly = internalAction({
  args: { url: v.string() },
  returns: v.object({
    title: v.union(v.string(), v.null()),
    price: v.union(v.number(), v.null()),
    currency: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!isProductPageUrl(args.url)) {
      return { title: null, price: null, currency: null };
    }

    const source = detectSource(args.url);

    if (source === "web") {
      const free = await tryFreeEnrich(args.url);
      if (free && free.price !== undefined) {
        return {
          title: free.title ?? null,
          price: free.price,
          currency: "USD",
        };
      }
    }

    try {
      const result = await firecrawlScrapeLean(ctx, args.url);
      return {
        title: result.title,
        price: result.price,
        currency: result.currency,
      };
    } catch (error) {
      console.error("Price scrape failed", args.url, error);
      return { title: null, price: null, currency: null };
    }
  },
});
