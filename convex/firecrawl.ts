import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { internalAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const firecrawl = new FirecrawlClient(components.firecrawl);

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

function detectSource(url: string): "amazon" | "etsy" | "web" {
  const lower = url.toLowerCase();
  if (lower.includes("amazon.") || lower.includes("amzn.")) return "amazon";
  if (lower.includes("etsy.")) return "etsy";
  return "web";
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

export const searchAndStore = internalAction({
  args: {
    sessionId: v.id("sessions"),
    queryId: v.id("openQueries"),
    searchQuery: v.string(),
    includeDomains: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    stored: v.number(),
    created: v.number(),
    results: v.array(findingResultValidator),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 6, 10);
    const fetchLimit = Math.min(limit * 2, 15);
    const response = await firecrawl.search(ctx, args.searchQuery, {
      limit: fetchLimit,
      includeDomains: args.includeDomains,
      scrapeOptions: {
        formats: ["markdown", "summary", "images"],
        onlyMainContent: true,
      },
    });

    // FirecrawlClient returns SearchResponse: { web?, news?, images?, developer? }
    // (not the raw API envelope with a `data` wrapper).
    const hits = extractSearchHits(response);

    let stored = 0;
    let created = 0;
    const results: Array<{
      title: string;
      url: string;
      source: "amazon" | "etsy" | "web";
      summary: string | null;
      price: number | null;
      currency: string | null;
      imageUrl: string | null;
    }> = [];

    for (const hit of hits) {
      if (results.length >= limit) break;

      const url = String(hit.url ?? hit.sourceURL ?? "").trim();
      if (!url || !isProductPageUrl(url)) continue;

      const metadata =
        hit.metadata && typeof hit.metadata === "object"
          ? (hit.metadata as { title?: string; description?: string })
          : undefined;
      const title = String(
        hit.title ?? metadata?.title ?? url,
      ).slice(0, 200);
      const source = detectSource(url);
      const summary =
        typeof hit.description === "string"
          ? hit.description
          : typeof hit.summary === "string"
            ? hit.summary
            : typeof metadata?.description === "string"
              ? metadata.description
              : typeof hit.markdown === "string"
                ? hit.markdown.slice(0, 400)
                : null;
      const price =
        priceFromProduct(hit.product) ??
        parsePrice(summary ?? undefined) ??
        parsePrice(title);
      const imageUrl = extractImageUrl(hit);

      const upserted = await ctx.runMutation(internal.findings.upsertFinding, {
        queryId: args.queryId,
        sessionId: args.sessionId,
        title: title || url,
        url,
        price,
        currency: price !== undefined ? "USD" : undefined,
        source,
        summary: summary ?? undefined,
        imageUrl: imageUrl ?? undefined,
      });
      stored += 1;
      if (upserted.created) created += 1;
      results.push({
        title: title || url,
        url,
        source,
        summary,
        price: price ?? null,
        currency: price !== undefined ? "USD" : null,
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

    const page = await firecrawl.scrape(ctx, args.url, {
      formats: [
        "markdown",
        "summary",
        "images",
        "product",
        {
          type: "json",
          prompt:
            "Extract product title, price number, currency, a one-sentence summary, and the main product image URL.",
        },
      ],
      onlyMainContent: true,
    });

    const pageRecord = page as Record<string, unknown>;
    const json =
      pageRecord.json && typeof pageRecord.json === "object"
        ? (pageRecord.json as Record<string, unknown>)
        : {};
    const metadata =
      pageRecord.metadata && typeof pageRecord.metadata === "object"
        ? (pageRecord.metadata as Record<string, unknown>)
        : undefined;
    const product = pageRecord.product;

    const title = String(
      (product &&
      typeof product === "object" &&
      typeof (product as { title?: unknown }).title === "string"
        ? (product as { title: string }).title
        : null) ??
        json.title ??
        metadata?.title ??
        args.url,
    ).slice(0, 200);

    const summary =
      typeof json.summary === "string"
        ? json.summary
        : typeof pageRecord.summary === "string"
          ? pageRecord.summary
          : product &&
              typeof product === "object" &&
              typeof (product as { description?: unknown }).description ===
                "string"
            ? String((product as { description: string }).description).slice(
                0,
                500,
              )
            : typeof pageRecord.markdown === "string"
              ? String(pageRecord.markdown).slice(0, 500)
              : null;

    const price =
      typeof json.price === "number"
        ? json.price
        : priceFromProduct(product) ??
          parsePrice(String(json.price ?? summary ?? ""));
    const currency =
      typeof json.currency === "string"
        ? json.currency
        : price !== undefined
          ? "USD"
          : undefined;
    const source = detectSource(args.url);
    const imageUrl =
      asHttpUrl(json.imageUrl) ??
      asHttpUrl(json.image) ??
      extractImageUrl(pageRecord);

    await ctx.runMutation(internal.findings.upsertFinding, {
      queryId: args.queryId as Id<"openQueries">,
      sessionId: args.sessionId,
      title,
      url: args.url,
      price,
      currency,
      source,
      summary: summary ?? undefined,
      imageUrl: imageUrl ?? undefined,
    });

    return {
      title,
      url: args.url,
      price: price ?? null,
      currency: currency ?? null,
      summary,
      source,
      imageUrl: imageUrl ?? null,
    };
  },
});
