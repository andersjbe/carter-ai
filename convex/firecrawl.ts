import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { internalAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const firecrawl = new FirecrawlClient(components.firecrawl);

function detectSource(url: string): "amazon" | "etsy" | "web" {
  const lower = url.toLowerCase();
  if (lower.includes("amazon.") || lower.includes("amzn.")) return "amazon";
  if (lower.includes("etsy.")) return "etsy";
  return "web";
}

function parsePrice(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
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
    results: v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        source: v.union(
          v.literal("amazon"),
          v.literal("etsy"),
          v.literal("web"),
        ),
        summary: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 6, 10);
    const response = await firecrawl.search(ctx, args.searchQuery, {
      limit,
      includeDomains: args.includeDomains,
      scrapeOptions: {
        formats: ["markdown", "summary"],
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
    }> = [];

    for (const hit of hits.slice(0, limit)) {
      const url = String(hit.url ?? hit.sourceURL ?? "").trim();
      const metadata =
        hit.metadata && typeof hit.metadata === "object"
          ? (hit.metadata as { title?: string; description?: string })
          : undefined;
      const title = String(
        hit.title ?? metadata?.title ?? url,
      ).slice(0, 200);
      if (!url) continue;
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
      const price = parsePrice(summary ?? undefined) ?? parsePrice(title);

      const upserted = await ctx.runMutation(internal.findings.upsertFinding, {
        queryId: args.queryId,
        sessionId: args.sessionId,
        title: title || url,
        url,
        price,
        currency: price !== undefined ? "USD" : undefined,
        source,
        summary: summary ?? undefined,
      });
      stored += 1;
      if (upserted.created) created += 1;
      results.push({ title: title || url, url, source, summary });
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
  returns: v.object({
    title: v.string(),
    url: v.string(),
    price: v.union(v.number(), v.null()),
    summary: v.union(v.string(), v.null()),
    source: v.union(v.literal("amazon"), v.literal("etsy"), v.literal("web")),
  }),
  handler: async (ctx, args) => {
    const page = await firecrawl.scrape(ctx, args.url, {
      formats: [
        "markdown",
        "summary",
        {
          type: "json",
          prompt:
            "Extract product title, price number, currency, and a one-sentence summary.",
        },
      ],
      onlyMainContent: true,
    });

    const json = (page as { json?: Record<string, unknown> }).json ?? {};
    const title = String(
      json.title ??
        (page as { metadata?: { title?: string } }).metadata?.title ??
        args.url,
    ).slice(0, 200);
    const summary =
      typeof json.summary === "string"
        ? json.summary
        : typeof (page as { summary?: string }).summary === "string"
          ? (page as { summary: string }).summary
          : typeof (page as { markdown?: string }).markdown === "string"
            ? String((page as { markdown: string }).markdown).slice(0, 500)
            : null;
    const price =
      typeof json.price === "number"
        ? json.price
        : parsePrice(String(json.price ?? summary ?? ""));
    const currency =
      typeof json.currency === "string" ? json.currency : price ? "USD" : undefined;
    const source = detectSource(args.url);

    await ctx.runMutation(internal.findings.upsertFinding, {
      queryId: args.queryId as Id<"openQueries">,
      sessionId: args.sessionId,
      title,
      url: args.url,
      price,
      currency,
      source,
      summary: summary ?? undefined,
    });

    return {
      title,
      url: args.url,
      price: price ?? null,
      summary,
      source,
    };
  },
});
