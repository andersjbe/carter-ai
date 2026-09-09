import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

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
      lastCheckedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
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
      lastCheckedAt: row.lastCheckedAt ?? null,
    }));
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
    status: v.optional(statusValidator),
  },
  returns: v.id("openQueries"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("openQueries", {
      sessionId: args.sessionId,
      profileId: args.profileId,
      title: args.title,
      brief: args.brief,
      searchHints: args.searchHints,
      sources: args.sources ?? ["amazon", "etsy", "web"],
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
      status: row.status,
    };
  },
});
