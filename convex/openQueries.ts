import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireOwnedSession } from "./lib/sessionAuth";
import {
  normalizeCustomDomains,
  type MarketplaceSource,
} from "./lib/searchScope";

const sourceValidator = v.union(
  v.literal("amazon"),
  v.literal("etsy"),
  v.literal("web"),
);

const statusValidator = v.union(
  v.literal("gathering"),
  v.literal("active"),
  v.literal("paused"),
);

export const listForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(
    v.object({
      _id: v.id("openQueries"),
      title: v.string(),
      brief: v.string(),
      status: statusValidator,
      sources: v.union(v.array(sourceValidator), v.null()),
      customDomains: v.union(v.array(v.string()), v.null()),
      lastCheckedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const rows = await ctx.db
      .query("openQueries")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .take(50);
    return rows.map((row) => ({
      _id: row._id,
      title: row.title,
      brief: row.brief,
      status: row.status,
      sources: row.sources ?? null,
      customDomains: row.customDomains ?? null,
      lastCheckedAt: row.lastCheckedAt ?? null,
    }));
  },
});

export const updateSearchScope = mutation({
  args: {
    sessionId: v.id("sessions"),
    queryId: v.id("openQueries"),
    sources: v.array(sourceValidator),
    customDomains: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const queryDoc = await ctx.db.get(args.queryId);
    if (!queryDoc || queryDoc.sessionId !== args.sessionId) {
      throw new Error("Unauthorized");
    }

    const customDomains = normalizeCustomDomains(args.customDomains);
    const sources = dedupeSources(args.sources);

    if (sources.length === 0 && customDomains.length === 0) {
      throw new Error(
        "Select at least one marketplace or add a custom domain",
      );
    }

    await ctx.db.patch(args.queryId, {
      sources,
      customDomains: customDomains.length > 0 ? customDomains : undefined,
    });
    return null;
  },
});

export const create = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    profileId: v.optional(v.id("profiles")),
    title: v.string(),
    brief: v.string(),
    searchHints: v.optional(v.array(v.string())),
    sources: v.optional(v.array(sourceValidator)),
    customDomains: v.optional(v.array(v.string())),
    status: v.optional(statusValidator),
  },
  returns: v.id("openQueries"),
  handler: async (ctx, args) => {
    const customDomains = args.customDomains
      ? normalizeCustomDomains(args.customDomains)
      : undefined;
    return await ctx.db.insert("openQueries", {
      sessionId: args.sessionId,
      profileId: args.profileId,
      title: args.title,
      brief: args.brief,
      searchHints: args.searchHints,
      sources: args.sources ?? ["amazon", "etsy", "web"],
      customDomains:
        customDomains && customDomains.length > 0
          ? customDomains
          : undefined,
      status: args.status ?? "active",
    });
  },
});

export const setStatus = internalMutation({
  args: {
    queryId: v.id("openQueries"),
    status: statusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.queryId, { status: args.status });
    return null;
  },
});

export const touchChecked = internalMutation({
  args: { queryId: v.id("openQueries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.queryId, { lastCheckedAt: Date.now() });
    return null;
  },
});

export const listActive = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("openQueries"),
      sessionId: v.id("sessions"),
      title: v.string(),
      brief: v.string(),
      searchHints: v.union(v.array(v.string()), v.null()),
      sources: v.union(v.array(sourceValidator), v.null()),
      customDomains: v.union(v.array(v.string()), v.null()),
      lastCheckedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("openQueries")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(40);
    return rows.map((row) => ({
      _id: row._id,
      sessionId: row.sessionId,
      title: row.title,
      brief: row.brief,
      searchHints: row.searchHints ?? null,
      sources: row.sources ?? null,
      customDomains: row.customDomains ?? null,
      lastCheckedAt: row.lastCheckedAt ?? null,
    }));
  },
});

export const getInternal = internalQuery({
  args: { queryId: v.id("openQueries") },
  returns: v.union(
    v.object({
      _id: v.id("openQueries"),
      sessionId: v.id("sessions"),
      title: v.string(),
      brief: v.string(),
      searchHints: v.union(v.array(v.string()), v.null()),
      sources: v.union(v.array(sourceValidator), v.null()),
      customDomains: v.union(v.array(v.string()), v.null()),
      status: statusValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.queryId);
    if (!row) return null;
    return {
      _id: row._id,
      sessionId: row.sessionId,
      title: row.title,
      brief: row.brief,
      searchHints: row.searchHints ?? null,
      sources: row.sources ?? null,
      customDomains: row.customDomains ?? null,
      status: row.status,
    };
  },
});

function dedupeSources(sources: MarketplaceSource[]): MarketplaceSource[] {
  const order: MarketplaceSource[] = ["amazon", "etsy", "web"];
  const set = new Set(sources);
  return order.filter((s) => set.has(s));
}
