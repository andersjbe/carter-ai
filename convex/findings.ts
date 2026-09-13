import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireOwnedSession } from "./lib/sessionAuth";

const sourceValidator = v.union(
  v.literal("amazon"),
  v.literal("etsy"),
  v.literal("web"),
);

const publicVerdictValidator = v.union(
  v.literal("accepted"),
  v.literal("rejected"),
  v.null(),
);

function fingerprint(url: string, title: string) {
  return `${url.trim().toLowerCase()}|${title.trim().toLowerCase()}`.slice(
    0,
    400,
  );
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

export const listForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(
    v.object({
      _id: v.id("findings"),
      queryId: v.id("openQueries"),
      title: v.string(),
      url: v.string(),
      price: v.union(v.number(), v.null()),
      currency: v.union(v.string(), v.null()),
      source: sourceValidator,
      summary: v.union(v.string(), v.null()),
      imageUrl: v.union(v.string(), v.null()),
      seenAt: v.number(),
      isNew: v.boolean(),
      verdict: publicVerdictValidator,
    }),
  ),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(80);
    return rows
      .filter((row) => row.verdict !== "rejected")
      .slice(0, 60)
      .map((row) => ({
        _id: row._id,
        queryId: row.queryId,
        title: row.title,
        url: row.url,
        price: row.price ?? null,
        currency: row.currency ?? null,
        source: row.source,
        summary: row.summary ?? null,
        imageUrl: row.imageUrl ?? null,
        seenAt: row.seenAt,
        isNew: row.isNew,
        verdict: row.verdict ?? null,
      }));
  },
});

export const listForQuery = query({
  args: { queryId: v.id("openQueries") },
  returns: v.array(
    v.object({
      _id: v.id("findings"),
      title: v.string(),
      url: v.string(),
      price: v.union(v.number(), v.null()),
      currency: v.union(v.string(), v.null()),
      source: sourceValidator,
      summary: v.union(v.string(), v.null()),
      imageUrl: v.union(v.string(), v.null()),
      isNew: v.boolean(),
      seenAt: v.number(),
      verdict: publicVerdictValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const openQuery = await ctx.db.get(args.queryId);
    if (!openQuery) return [];
    await requireOwnedSession(ctx, openQuery.sessionId);
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_query", (q) => q.eq("queryId", args.queryId))
      .order("desc")
      .take(60);
    return rows
      .filter((row) => row.verdict !== "rejected")
      .slice(0, 40)
      .map((row) => ({
        _id: row._id,
        title: row.title,
        url: row.url,
        price: row.price ?? null,
        currency: row.currency ?? null,
        source: row.source,
        summary: row.summary ?? null,
        imageUrl: row.imageUrl ?? null,
        isNew: row.isNew,
        seenAt: row.seenAt,
        verdict: row.verdict ?? null,
      }));
  },
});

export const setVerdict = mutation({
  args: {
    findingId: v.id("findings"),
    verdict: publicVerdictValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finding = await ctx.db.get(args.findingId);
    if (!finding) {
      throw new Error("Finding not found");
    }
    await requireOwnedSession(ctx, finding.sessionId);

    if (args.verdict === null) {
      await ctx.db.patch(args.findingId, {
        verdict: undefined,
        verdictAt: undefined,
      });
      return null;
    }

    await ctx.db.patch(args.findingId, {
      verdict: args.verdict,
      verdictAt: Date.now(),
    });
    return null;
  },
});

export const upsertFinding = internalMutation({
  args: {
    queryId: v.id("openQueries"),
    sessionId: v.id("sessions"),
    title: v.string(),
    url: v.string(),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    source: sourceValidator,
    summary: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  returns: v.object({
    findingId: v.id("findings"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const fp = fingerprint(args.url, args.title);
    const existing = await ctx.db
      .query("findings")
      .withIndex("by_query_fingerprint", (q) =>
        q.eq("queryId", args.queryId).eq("fingerprint", fp),
      )
      .unique();

    if (existing) {
      const cheaper =
        args.price !== undefined &&
        existing.price !== undefined &&
        args.price < existing.price;
      // Preserve verdict / verdictAt on re-upsert (price/image refresh only).
      await ctx.db.patch(existing._id, {
        price: args.price ?? existing.price,
        currency: args.currency ?? existing.currency,
        summary: args.summary ?? existing.summary,
        imageUrl: args.imageUrl ?? existing.imageUrl,
        seenAt: Date.now(),
        isNew: cheaper ? true : existing.isNew,
      });
      return { findingId: existing._id, created: cheaper };
    }

    const findingId = await ctx.db.insert("findings", {
      queryId: args.queryId,
      sessionId: args.sessionId,
      title: args.title,
      url: args.url,
      price: args.price,
      currency: args.currency,
      source: args.source,
      summary: args.summary,
      imageUrl: args.imageUrl,
      fingerprint: fp,
      seenAt: Date.now(),
      isNew: true,
    });
    return { findingId, created: true };
  },
});

export const markSeen = internalMutation({
  args: { queryId: v.id("openQueries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_query", (q) => q.eq("queryId", args.queryId))
      .take(100);
    for (const row of rows) {
      if (row.isNew) {
        await ctx.db.patch(row._id, { isNew: false });
      }
    }
    return null;
  },
});

const findingForAgentValidator = v.object({
  title: v.string(),
  url: v.string(),
  price: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  source: sourceValidator,
  summary: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
  verdict: publicVerdictValidator,
});

const rejectedSummaryValidator = v.object({
  title: v.string(),
  url: v.string(),
});

/** Active (non-rejected) findings + compact rejected list for agent memory. */
export const listByQueryInternal = internalQuery({
  args: { queryId: v.id("openQueries") },
  returns: v.object({
    findings: v.array(findingForAgentValidator),
    rejected: v.array(rejectedSummaryValidator),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_query", (q) => q.eq("queryId", args.queryId))
      .order("desc")
      .take(60);

    const findings = [];
    const rejected = [];
    for (const row of rows) {
      if (row.verdict === "rejected") {
        rejected.push({ title: row.title, url: row.url });
        continue;
      }
      findings.push({
        title: row.title,
        url: row.url,
        price: row.price ?? null,
        currency: row.currency ?? null,
        source: row.source,
        summary: row.summary ?? null,
        imageUrl: row.imageUrl ?? null,
        verdict: row.verdict ?? null,
      });
    }
    return {
      findings: findings.slice(0, 40),
      rejected: rejected.slice(0, 20),
    };
  },
});

/** Normalized URL keys already stored for a query — used to skip re-scrapes. */
export const listUrlKeysForQuery = internalQuery({
  args: { queryId: v.id("openQueries") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_query", (q) => q.eq("queryId", args.queryId))
      .take(100);
    return rows.map((row) => normalizeUrlKey(row.url));
  },
});

/** Public: rejected product URLs for this session (chat grids filter these). */
export const listRejectedUrlsForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_session_and_verdict", (q) =>
        q.eq("sessionId", args.sessionId).eq("verdict", "rejected"),
      )
      .take(100);
    return rows.map((row) => row.url);
  },
});

/** Session-wide rejected product URL keys — skip across open queries. */
export const listRejectedUrlKeysForSession = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_session_and_verdict", (q) =>
        q.eq("sessionId", args.sessionId).eq("verdict", "rejected"),
      )
      .take(100);
    return rows.map((row) => normalizeUrlKey(row.url));
  },
});

export const listNewForQuery = internalQuery({
  args: { queryId: v.id("openQueries") },
  returns: v.array(
    v.object({
      title: v.string(),
      url: v.string(),
      price: v.union(v.number(), v.null()),
      currency: v.union(v.string(), v.null()),
      source: sourceValidator,
      summary: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_query", (q) => q.eq("queryId", args.queryId))
      .take(50);
    return rows
      .filter((row) => row.isNew && row.verdict !== "rejected")
      .map((row) => ({
        title: row.title,
        url: row.url,
        price: row.price ?? null,
        currency: row.currency ?? null,
        source: row.source,
        summary: row.summary ?? null,
      }));
  },
});
