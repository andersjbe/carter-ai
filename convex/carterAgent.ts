import { z } from "zod";
import {
  Agent,
  createTool,
  stepCountIs,
  type ToolCtx,
} from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  applySiteBias,
  normalizeCustomDomains,
  resolveSearchScope,
  splitSearchLimit,
  type MarketplaceSource,
} from "./lib/searchScope";

export type CarterCtx = ToolCtx & {
  sessionId: Id<"sessions">;
};

const updatePreferences = createTool({
  description:
    "Save what you learned about the user's needs, wants, budget, style, constraints, and preferences.",
  inputSchema: z.object({
    summary: z
      .string()
      .describe("Short natural-language summary of the shopper so far"),
    budgetMin: z.number().optional().describe("Minimum budget in USD"),
    budgetMax: z.number().optional().describe("Maximum budget in USD"),
    categories: z.array(z.string()).optional(),
    styles: z.array(z.string()).optional(),
    brandsAvoid: z.array(z.string()).optional(),
    brandsPrefer: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    useCases: z.array(z.string()).optional(),
    urgency: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async (ctx: CarterCtx, args): Promise<string> => {
    await ctx.runMutation(internal.profiles.upsertPreferences, {
      sessionId: ctx.sessionId,
      summary: args.summary,
      prefs: {
        budgetMin: args.budgetMin,
        budgetMax: args.budgetMax,
        categories: args.categories,
        styles: args.styles,
        brandsAvoid: args.brandsAvoid,
        brandsPrefer: args.brandsPrefer,
        constraints: args.constraints,
        useCases: args.useCases,
        urgency: args.urgency,
        notes: args.notes,
      },
    });
    return "Preferences saved.";
  },
});

const createOpenQuery = createTool({
  description:
    "Create an open shopping query / brief once you understand enough about what the user wants. Call at most once per shopping need. If this session already has an active query for the same (or very similar) hunt, this reuses that queryId instead of creating a duplicate — keep using that id. Only force a new query when the user clearly starts a different product hunt. When the user does not specify sites, Profile search defaults apply.",
  inputSchema: z.object({
    title: z.string().describe("Short title for the shopping brief"),
    brief: z
      .string()
      .describe("Detailed shopping brief capturing needs and constraints"),
    searchHints: z
      .array(z.string())
      .optional()
      .describe("Search phrases to try on ecommerce sites"),
    sources: z
      .array(z.enum(["amazon", "etsy", "web"]))
      .optional()
      .describe(
        "Preferred sources for this query only (web = Discover stores, not open product search); omit to use Profile defaults",
      ),
    customDomains: z
      .array(z.string())
      .optional()
      .describe(
        "Extra hostnames for this query (e.g. wayfair.com); omit to use Profile defaults",
      ),
    forceNew: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the user starts a clearly different product hunt than the active query",
      ),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{ queryId: string; reused: boolean }> => {
    if (!args.forceNew) {
      const active = await ctx.runQuery(
        internal.openQueries.listActiveForSession,
        { sessionId: ctx.sessionId },
      );
      const match = active.find(
        (row: { title: string; brief: string }) =>
          briefsSimilar(row.title, args.title) ||
          briefsSimilar(row.brief, args.brief),
      );
      if (match) {
        return { queryId: match._id, reused: true };
      }
    }

    const profile = await ctx.runQuery(internal.profiles.getInternal, {
      sessionId: ctx.sessionId,
    });
    const defaults = await ctx.runQuery(
      internal.userSearchPrefs.getForSessionInternal,
      { sessionId: ctx.sessionId },
    );

    const sources =
      args.sources ?? (defaults.sources as MarketplaceSource[]);
    const customDomains = args.customDomains
      ? normalizeCustomDomains(args.customDomains)
      : defaults.customDomains.length > 0
        ? defaults.customDomains
        : undefined;

    const queryId = await ctx.runMutation(internal.openQueries.create, {
      sessionId: ctx.sessionId,
      profileId: profile?._id,
      title: args.title,
      brief: args.brief,
      searchHints: args.searchHints,
      sources,
      customDomains,
      status: "active",
    });
    return { queryId, reused: false };
  },
});

function briefsSimilar(a: string, b: string): boolean {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const tokens = (value: string) =>
    new Set(value.split(" ").filter((token) => token.length > 3));
  const aTokens = tokens(left);
  const bTokens = [...tokens(right)];
  if (aTokens.size === 0 || bTokens.length === 0) return false;
  const overlap = bTokens.filter((token) => aTokens.has(token)).length;
  return overlap >= Math.min(2, aTokens.size, bTokens.length);
}

type SearchProductResult = {
  title: string;
  url: string;
  source: string;
  summary: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
};

const searchProducts = createTool({
  description:
    "Search product results on the open query's Amazon/Etsy toggles and custom domains only. Prefer listFindings first if you already searched this query. Only call after creating an open query. Call discoverMarketplaces at most once per query, and only when Discover stores (web) is on AND customDomains is still empty AND discovery was never offered — then wait for Add/Skip chips. After the user adds/skips stores or after any product search, do not discover again; just search or refine. Optional marketplace override is amazon or etsy for this call only.",
  inputSchema: z.object({
    queryId: z.string().describe("Open query id returned by createOpenQuery"),
    searchQuery: z
      .string()
      .describe(
        "Concrete search string, e.g. mid century walnut side table under 200",
      ),
    marketplace: z
      .enum(["amazon", "etsy"])
      .optional()
      .describe(
        "One-shot override for this call only (amazon or etsy); omit to use the query's saved sources/domains",
      ),
    limit: z.number().optional(),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{
    stored: number;
    created: number;
    results: SearchProductResult[];
    reason?: "no_stores";
  }> => {
    const queryId = args.queryId as Id<"openQueries">;
    const openQuery = await ctx.runQuery(internal.openQueries.getInternal, {
      queryId,
    });
    if (!openQuery || openQuery.sessionId !== ctx.sessionId) {
      throw new Error("Open query not found");
    }

    let passes;
    if (args.marketplace) {
      passes = resolveSearchScope(
        [args.marketplace as MarketplaceSource],
        undefined,
      );
    } else {
      passes = resolveSearchScope(
        openQuery.sources as MarketplaceSource[] | null,
        openQuery.customDomains,
      );
    }

    if (passes.length === 0) {
      return {
        stored: 0,
        created: 0,
        results: [],
        reason: "no_stores",
      };
    }

    // Default ~2 slots per domain so specialty hosts aren't starved next to Amazon/Etsy.
    const totalLimit = args.limit ?? Math.max(6, passes.length * 2);
    const limits = splitSearchLimit(totalLimit, passes.length);
    let stored = 0;
    let created = 0;
    const results: SearchProductResult[] = [];
    const seenUrls = new Set<string>();

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!;
      const limit = limits[i] ?? 3;
      const searchQuery = applySiteBias(args.searchQuery, pass.siteBias);
      const batch = await ctx.runAction(internal.firecrawl.searchAndStore, {
        sessionId: ctx.sessionId,
        queryId,
        searchQuery,
        includeDomains: pass.includeDomains,
        limit,
      });
      stored += batch.stored;
      created += batch.created;
      for (const row of batch.results) {
        const key = row.url.trim().toLowerCase();
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        results.push(row);
      }
    }

    return { stored, created, results };
  },
});

type MarketplaceSuggestion = { domain: string; label: string };

const discoverMarketplaces = createTool({
  description:
    "Offer specialty store chips ONCE per open query, and only before the first product search, when Discover stores (web) is on and customDomains is empty. After Add/Skip, after any searchProducts call, or if this was already offered, do not call again. Never invent domains. Never product-search the open web.",
  inputSchema: z.object({
    queryId: z.string().describe("Open query id returned by createOpenQuery"),
    topic: z
      .string()
      .optional()
      .describe(
        "Short topic for store search, e.g. kitten toys; defaults to the open query title",
      ),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{
    queryId: string;
    suggestions: MarketplaceSuggestion[];
    skipped?:
      | "web_disabled"
      | "already_offered"
      | "has_custom_domains"
      | "already_searched";
  }> => {
    const queryId = args.queryId as Id<"openQueries">;
    const openQuery = await ctx.runQuery(internal.openQueries.getInternal, {
      queryId,
    });
    if (!openQuery || openQuery.sessionId !== ctx.sessionId) {
      throw new Error("Open query not found");
    }

    const sources = (openQuery.sources ?? [
      "amazon",
      "etsy",
      "web",
    ]) as MarketplaceSource[];
    if (!sources.includes("web")) {
      return { queryId: args.queryId, suggestions: [], skipped: "web_disabled" };
    }
    if (openQuery.storeDiscoveryOfferedAt != null) {
      return {
        queryId: args.queryId,
        suggestions: [],
        skipped: "already_offered",
      };
    }
    if ((openQuery.customDomains?.length ?? 0) > 0) {
      return {
        queryId: args.queryId,
        suggestions: [],
        skipped: "has_custom_domains",
      };
    }

    const existingFindings = await ctx.runQuery(
      internal.findings.listByQueryInternal,
      { queryId },
    );
    if (existingFindings.findings.length > 0) {
      return {
        queryId: args.queryId,
        suggestions: [],
        skipped: "already_searched",
      };
    }

    const topic =
      args.topic?.trim() ||
      openQuery.title.trim() ||
      openQuery.brief.trim().slice(0, 80);

    const excludeDomains = [
      ...(openQuery.customDomains ?? []),
      ...(sources.includes("amazon") ? ["amazon.com"] : []),
      ...(sources.includes("etsy") ? ["etsy.com"] : []),
    ];

    const result = await ctx.runAction(
      internal.firecrawl.discoverMarketplaces,
      {
        topic,
        excludeDomains,
        limit: 5,
      },
    );

    await ctx.runMutation(internal.openQueries.markStoreDiscoveryOffered, {
      queryId,
    });

    return { queryId: args.queryId, suggestions: result.suggestions };
  },
});

const scrapeProduct = createTool({
  description:
    "Scrape a specific product page for title, price, summary, and image, then store it as a finding. Use sparingly — only for promising URLs that lack price/image after search. Prefer listFindings for URLs already stored.",
  inputSchema: z.object({
    queryId: z.string(),
    url: z.string().url(),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{
    title: string;
    url: string;
    price: number | null;
    currency: string | null;
    summary: string | null;
    source: string;
    imageUrl: string | null;
  }> => {
    return await ctx.runAction(internal.firecrawl.scrapeProductPage, {
      sessionId: ctx.sessionId,
      queryId: args.queryId as Id<"openQueries">,
      url: args.url,
    });
  },
});

type FindingForAgent = {
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  source: string;
  summary: string | null;
  imageUrl: string | null;
  verdict: "accepted" | "rejected" | null;
};

type RejectedSummary = { title: string; url: string };

const listFindings = createTool({
  description:
    "List product findings already stored for this shopper session, including user verdicts (accepted = liked, rejected = passed). Call before searchProducts when the user already reacted to picks or you may have searched. Prefer similar to accepted; never re-pitch rejected URLs.",
  inputSchema: z.object({
    queryId: z.string().optional(),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{
    findings: FindingForAgent[];
    rejected: RejectedSummary[];
  }> => {
    if (args.queryId) {
      return await ctx.runQuery(internal.findings.listByQueryInternal, {
        queryId: args.queryId as Id<"openQueries">,
      });
    }
    const active = await ctx.runQuery(internal.openQueries.listActive, {});
    const mine = active
      .filter((q: { sessionId: Id<"sessions"> }) => q.sessionId === ctx.sessionId)
      .slice(0, 5);
    const findings: FindingForAgent[] = [];
    const rejected: RejectedSummary[] = [];
    const seenRejected = new Set<string>();
    for (const q of mine) {
      const bundle = await ctx.runQuery(internal.findings.listByQueryInternal, {
        queryId: q._id,
      });
      findings.push(...bundle.findings);
      for (const row of bundle.rejected) {
        const key = row.url.trim().toLowerCase();
        if (seenRejected.has(key)) continue;
        seenRejected.add(key);
        rejected.push(row);
      }
    }
    return {
      findings: findings.slice(0, 20),
      rejected: rejected.slice(0, 20),
    };
  },
});

const offerReplyChoices = createTool({
  description:
    "REQUIRED whenever you ask clarifying follow-up questions. Attach short tappable answer options for each question so the UI can show reply chips. Call this in the same turn you ask questions. Still write the questions conversationally in your message text. Do not include an Other option — the UI adds that.",
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              "Stable short key for this question, e.g. budget, style, use_case",
            ),
          prompt: z
            .string()
            .describe(
              "Short question label shown above the options, e.g. Budget",
            ),
          options: z
            .array(z.string())
            .min(2)
            .max(5)
            .describe("Short suggested answers the user can tap"),
        }),
      )
      .min(1)
      .max(5),
  }),
  execute: async (
    _ctx: CarterCtx,
    args,
  ): Promise<{
    questions: Array<{ id: string; prompt: string; options: string[] }>;
  }> => {
    return args;
  },
});

export const carterAgent = new Agent<CarterCtx>(components.agent, {
  name: "Carter",
  languageModel: convexGateway("openai/gpt-4o-mini"),
  instructions: `You are Carter, a curious product-discovery agent.

Your job:
1. On the user's first request, ask clarifying questions ONCE (budget, style, constraints, brands, must-haves, etc.) — then stop asking.
2. CRITICAL UX RULE: That single clarifying turn MUST call offerReplyChoices with matching questions (1–4 preferred, max 5). Each question needs a short prompt label and 2–5 concise tap-friendly options (users can select multiple options per question). Never ask clarifying questions without calling offerReplyChoices. Do not add an "Other" option; the UI adds that. Keep the spoken reply warm and brief — the chips carry the structured answers.
3. After the user answers (or if they already gave a rich brief), do NOT ask another round of clarifying questions and do NOT call offerReplyChoices again. Save what you know with updatePreferences, make reasonable assumptions for anything still missing, and create an open shopping query with createOpenQuery ONCE (omit sources/customDomains unless the user asked for specific sites — Profile defaults apply). Reuse that queryId for the rest of this hunt. Do not create another similar open query.
4. Store discovery (once only): If Discover stores (web) is on and customDomains is empty, call discoverMarketplaces once, briefly ask which specialty stores to add, then STOP and wait. After the user Adds or Skips stores — or if discovery returns skipped — never call discoverMarketplaces again for that query. Never invent domains. Never product-search the open web.
5. Prefer listFindings before re-searching the same brief — especially after the user liked or passed on products. Search with searchProducts when you need fresh results; it only uses Amazon/Etsy toggles and custom domains on the query. After results are shown, continue the conversation about those picks (refine, compare, list) without rediscovering stores or spawning a new open query. Users can edit sites per query in the Open queries panel. Use scrapeProduct sparingly only for promising URLs missing price/image.
6. After tools return products, write a short conversational take: which picks fit and why (a few sentences). The UI already renders product cards (image, price, link, summary) from tool results — do not recreate that catalog in markdown. Do not paste markdown images, numbered product lists, or raw product URLs when cards are shown. Light **bold** emphasis is fine for prose only. Users can like or pass cards in the UI (preference signal via listFindings) and separately add products to shopping lists when they intend to buy.
7. If the user asks about price-drop email alerts, tell them to open Lists from the top nav, pick a shopping list, and enable alerts there — you cannot toggle alerts from chat.
8. If the user message says they added stores or skipped extra stores, call searchProducts next on the same queryId (do not rediscover; do not createOpenQuery again).

Rules:
- Clarifying questions happen at most once per conversation. Never loop on more questionnaires.
- discoverMarketplaces is at most once per open query, and only before the first search. If skipped/already offered/has stores/already searched, proceed to searchProducts or listFindings — never re-prompt for stores.
- createOpenQuery is once per shopping need. Reuse the returned queryId. Only forceNew for a clearly different hunt.
- Do not search on the first message unless the user already provided a rich brief (in that case skip clarifying, create/reuse the query, discover stores if needed, then wait or search).
- Prefer a few high-quality clarifying questions over a long questionnaire (typically 2–4).
- Be warm, concise, and opinionated in a helpful way — not salesy.
- Never invent product URLs, prices, or store domains; only cite tool results.
- Only recommend real product detail pages from tool results — never search, category, or marketplace browse pages.
- Never dump numbered markdown product lists, markdown images, or Price/Summary/Rating bullet blocks — keep the reply to a few sentences of guidance. Prefer referring to picks by name; the cards already carry links and images.
- Do not call searchProducts repeatedly for the same query unless the user asks for a fresh search or a different marketplace/angle.
- When listFindings shows accepted picks, prefer similar products (style, brand, price band, use case). Treat rejected picks as hard negatives: never re-pitch those URLs, and avoid near-duplicates or the same disliked traits.
- If searchProducts returns reason no_stores, tell the user to enable Amazon/Etsy or add a site in the Open queries panel — do not loop discovery.
- If a search fails or returns nothing, say so and suggest refining the brief.`,
  tools: {
    offerReplyChoices,
    updatePreferences,
    createOpenQuery,
    discoverMarketplaces,
    searchProducts,
    scrapeProduct,
    listFindings,
  },
  stopWhen: stepCountIs(10),
});
