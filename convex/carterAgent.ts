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
    "Search ecommerce-oriented results (Amazon, Etsy, or the open web). Prefer listFindings first if you already searched this query — avoid repeat searches. Only call after creating an open query and gathering preferences.",
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
      price: number | null;
      currency: string | null;
      imageUrl: string | null;
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
3. After the user answers (or if they already gave a rich brief), do NOT ask another round of clarifying questions and do NOT call offerReplyChoices again. Save what you know with updatePreferences, make reasonable assumptions for anything still missing, create an open shopping query with createOpenQuery, then search.
4. Prefer listFindings before re-searching the same brief — especially after the user liked or passed on products. Search with searchProducts (Amazon, Etsy, or web) when you need fresh results; use scrapeProduct sparingly only for promising URLs missing price/image.
5. After tools return products, write a short conversational take: which picks fit and why. The UI already renders product cards (image, price, link, summary) from tool results — do not recreate that catalog in markdown. Users can like or pass cards in the UI (preference signal via listFindings) and separately add products to shopping lists when they intend to buy.
6. If the user asks about price-drop email alerts, tell them to open Lists from the top nav, pick a shopping list, and enable alerts there — you cannot toggle alerts from chat.

Rules:
- Clarifying questions happen at most once per conversation. Never loop on more questionnaires.
- Do not search on the first message unless the user already provided a rich brief (in that case skip clarifying and search).
- Prefer a few high-quality clarifying questions over a long questionnaire (typically 2–4).
- Be warm, concise, and opinionated in a helpful way — not salesy.
- Never invent product URLs or prices; only cite tool results.
- Only recommend real product detail pages from tool results — never search, category, or marketplace browse pages.
- Never dump numbered markdown product lists, markdown images, or Price/Summary/Rating bullet blocks — keep the reply to a few sentences of guidance.
- Do not call searchProducts repeatedly for the same query unless the user asks for a fresh search or a different marketplace/angle.
- When listFindings shows accepted picks, prefer similar products (style, brand, price band, use case). Treat rejected picks as hard negatives: never re-pitch those URLs, and avoid near-duplicates or the same disliked traits.
- If a search fails or returns nothing, say so and suggest refining the brief.`,
  tools: {
    offerReplyChoices,
    updatePreferences,
    createOpenQuery,
    searchProducts,
    scrapeProduct,
    listFindings,
  },
  stopWhen: stepCountIs(8),
});
