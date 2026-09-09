import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const prefsValidator = v.object({
  budgetMin: v.optional(v.number()),
  budgetMax: v.optional(v.number()),
  categories: v.optional(v.array(v.string())),
  styles: v.optional(v.array(v.string())),
  brandsAvoid: v.optional(v.array(v.string())),
  brandsPrefer: v.optional(v.array(v.string())),
  constraints: v.optional(v.array(v.string())),
  useCases: v.optional(v.array(v.string())),
  urgency: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const getForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      email: v.union(v.string(), v.null()),
      summary: v.union(v.string(), v.null()),
      prefs: v.union(prefsValidator, v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!profile) return null;
    return {
      _id: profile._id,
      email: profile.email ?? null,
      summary: profile.summary ?? null,
      prefs: profile.prefs ?? null,
    };
  },
});

export const upsertPreferences = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    summary: v.optional(v.string()),
    prefs: v.optional(prefsValidator),
    email: v.optional(v.string()),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        summary: args.summary ?? existing.summary,
        prefs: args.prefs
          ? { ...existing.prefs, ...args.prefs }
          : existing.prefs,
        email: args.email ?? existing.email,
      });
      return existing._id;
    }

    const profileId = await ctx.db.insert("profiles", {
      sessionId: args.sessionId,
      summary: args.summary,
      prefs: args.prefs,
      email: args.email,
    });
    await ctx.db.patch(args.sessionId, { profileId });
    return profileId;
  },
});

export const setEmail = mutation({
  args: {
    sessionId: v.id("sessions"),
    email: v.string(),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) {
      throw new Error("Enter a valid email address.");
    }
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { email });
      return existing._id;
    }
    const profileId = await ctx.db.insert("profiles", {
      sessionId: args.sessionId,
      email,
    });
    await ctx.db.patch(args.sessionId, { profileId });
    return profileId;
  },
});

export const getInternal = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      _id: v.id("profiles"),
      email: v.union(v.string(), v.null()),
      summary: v.union(v.string(), v.null()),
      prefs: v.union(prefsValidator, v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!profile) return null;
    return {
      _id: profile._id,
      email: profile.email ?? null,
      summary: profile.summary ?? null,
      prefs: profile.prefs ?? null,
    };
  },
});

export async function requireSession(
  ctx: { db: { get: (id: Id<"sessions">) => Promise<unknown> } },
  sessionId: Id<"sessions">,
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Unknown session");
  return session;
}
