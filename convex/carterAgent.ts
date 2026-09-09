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
    "Create an open shopping query / brief once you understand enough about what the user wants. Prefer doing this before searching.",
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
      .describe("Preferred marketplaces"),
  }),
  execute: async (ctx: CarterCtx, args): Promise<{ queryId: string }> => {
    const profile = await ctx.runQuery(internal.profiles.getInternal, {
      sessionId: ctx.sessionId,
    });
    const queryId = await ctx.runMutation(internal.openQueries.create, {
      sessionId: ctx.sessionId,
      profileId: profile?._id,
      title: args.title,
      brief: args.brief,
      searchHints: args.searchHints,
      sources: args.sources,
      status: "active",
    });
    return { queryId };
  },
});

const searchProducts = createTool({
  description:
    "Search ecommerce-oriented results with Firecrawl (Amazon, Etsy, or the open web). Only call after creating an open query and gathering preferences.",
  inputSchema: z.object({
    queryId: z.string().describe("Open query id returned by createOpenQuery"),
    searchQuery: z
      .string()
      .describe(
        "Concrete search string, e.g. mid century walnut side table under 200",
      ),
    marketplace: z
      .enum(["amazon", "etsy", "web"])
      .optional()
      .describe("Bias the search toward a marketplace"),
    limit: z.number().optional(),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<{
    stored: number;
    created: number;
    results: Array<{
      title: string;
      url: string;
      source: string;
      summary: string | null;
    }>;
  }> => {
    const includeDomains =
      args.marketplace === "amazon"
        ? ["amazon.com"]
        : args.marketplace === "etsy"
          ? ["etsy.com"]
          : undefined;
    const biasedQuery =
      args.marketplace === "amazon"
        ? `${args.searchQuery} site:amazon.com`
        : args.marketplace === "etsy"
          ? `${args.searchQuery} site:etsy.com`
          : args.searchQuery;

    return await ctx.runAction(internal.firecrawl.searchAndStore, {
      sessionId: ctx.sessionId,
      queryId: args.queryId as Id<"openQueries">,
      searchQuery: biasedQuery,
      includeDomains,
      limit: args.limit,
    });
  },
});

const scrapeProduct = createTool({
  description:
    "Scrape a specific product page for title, price, and summary, then store it as a finding.",
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
    summary: string | null;
    source: string;
  }> => {
    return await ctx.runAction(internal.firecrawl.scrapeProductPage, {
      sessionId: ctx.sessionId,
      queryId: args.queryId as Id<"openQueries">,
      url: args.url,
    });
  },
});

const listFindings = createTool({
  description: "List product findings already stored for this shopper session.",
  inputSchema: z.object({
    queryId: z.string().optional(),
  }),
  execute: async (
    ctx: CarterCtx,
    args,
  ): Promise<
    Array<{
      title: string;
      url: string;
      price: number | null;
      source: string;
      summary: string | null;
    }>
  > => {
    if (args.queryId) {
      const rows = await ctx.runQuery(internal.findings.listByQueryInternal, {
        queryId: args.queryId as Id<"openQueries">,
      });
      return rows.map(
        (r: {
          title: string;
          url: string;
          price: number | null;
          source: string;
          summary: string | null;
        }) => ({
          title: r.title,
          url: r.url,
          price: r.price,
          source: r.source,
          summary: r.summary,
        }),
      );
    }
    const active = await ctx.runQuery(internal.openQueries.listActive, {});
    const mine = active
      .filter((q: { sessionId: Id<"sessions"> }) => q.sessionId === ctx.sessionId)
      .slice(0, 5);
    const out: Array<{
      title: string;
      url: string;
      price: number | null;
      source: string;
      summary: string | null;
    }> = [];
    for (const q of mine) {
      const rows = await ctx.runQuery(internal.findings.listByQueryInternal, {
        queryId: q._id,
      });
      out.push(
        ...rows.map(
          (r: {
            title: string;
            url: string;
            price: number | null;
            source: string;
            summary: string | null;
          }) => ({
            title: r.title,
            url: r.url,
            price: r.price,
            source: r.source,
            summary: r.summary,
          }),
        ),
      );
    }
    return out.slice(0, 20);
  },
});

const setEmailAlerts = createTool({
  description:
    "Enable or disable email alerts for new products/sales related to the user's open queries. Requires a real email address when enabling.",
  inputSchema: z.object({
    enabled: z.boolean(),
    email: z.string().email().optional(),
  }),
  execute: async (ctx: CarterCtx, args): Promise<string> => {
    await ctx.runMutation(internal.mail.setAlertsInternal, {
      sessionId: ctx.sessionId,
      enabled: args.enabled,
      email: args.email,
    });
    return args.enabled
      ? "Email alerts enabled. Carter will email when new finds appear for open queries."
      : "Email alerts disabled.";
  },
});

export const carterAgent = new Agent<CarterCtx>(components.agent, {
  name: "Carter",
  languageModel: convexGateway("openai/gpt-4o-mini"),
  instructions: `You are Carter, a curious product-discovery agent.

Your job:
1. Be genuinely curious about the person before searching. Ask about use case, budget, style, constraints, brands they love or avoid, timeline, and must-haves vs nice-to-haves.
2. Save what you learn with updatePreferences as details emerge.
3. Only after you understand enough, create an open shopping query with createOpenQuery.
4. Then search with searchProducts (Amazon, Etsy, or web) and optionally scrapeProduct for promising URLs.
5. Present findings conversationally with links, prices when known, and why they fit.
6. Offer email alerts for ongoing open queries via setEmailAlerts when the user wants follow-ups on sales or new products.

Rules:
- Do not search on the first message unless the user already provided a rich brief.
- Prefer a few high-quality clarifying questions over a long questionnaire.
- Be warm, concise, and opinionated in a helpful way — not salesy.
- Never invent product URLs or prices; only cite tool results.
- If a search fails or returns nothing, say so and suggest refining the brief.`,
  tools: {
    updatePreferences,
    createOpenQuery,
    searchProducts,
    scrapeProduct,
    listFindings,
    setEmailAlerts,
  },
  stopWhen: stepCountIs(8),
});
