import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { createThread } from "@convex-dev/agent";
import { requireAuthUserId } from "./lib/sessionAuth";

export const getOrCreate = mutation({
  args: {},
  returns: v.object({
    sessionId: v.id("sessions"),
    threadId: v.string(),
    profileId: v.union(v.id("profiles"), v.null()),
  }),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);

    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing?.threadId) {
      return {
        sessionId: existing._id,
        threadId: existing.threadId,
        profileId: existing.profileId ?? null,
      };
    }

    const threadId = await createThread(ctx, components.agent, {
      title: "Carter discovery",
    });

    if (existing) {
      await ctx.db.patch(existing._id, { threadId });
      return {
        sessionId: existing._id,
        threadId,
        profileId: existing.profileId ?? null,
      };
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId,
      threadId,
    });

    return { sessionId, threadId, profileId: null };
  },
});

export const getMine = query({
  args: {},
  returns: v.union(
    v.object({
      sessionId: v.id("sessions"),
      threadId: v.union(v.string(), v.null()),
      profileId: v.union(v.id("profiles"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!session) return null;
    return {
      sessionId: session._id,
      threadId: session.threadId ?? null,
      profileId: session.profileId ?? null,
    };
  },
});

/** Deletes all Carter session-scoped data (dev reset). */
export const clearAllSessionData = internalMutation({
  args: {},
  returns: v.object({
    sessions: v.number(),
    profiles: v.number(),
    openQueries: v.number(),
    findings: v.number(),
    alertPrefs: v.number(),
  }),
  handler: async (ctx) => {
    const counts = {
      sessions: 0,
      profiles: 0,
      openQueries: 0,
      findings: 0,
      alertPrefs: 0,
    };

    for (const row of await ctx.db.query("findings").take(500)) {
      await ctx.db.delete(row._id);
      counts.findings += 1;
    }
    for (const row of await ctx.db.query("openQueries").take(500)) {
      await ctx.db.delete(row._id);
      counts.openQueries += 1;
    }
    for (const row of await ctx.db.query("alertPrefs").take(500)) {
      await ctx.db.delete(row._id);
      counts.alertPrefs += 1;
    }
    for (const row of await ctx.db.query("profiles").take(500)) {
      await ctx.db.delete(row._id);
      counts.profiles += 1;
    }
    for (const row of await ctx.db.query("sessions").take(500)) {
      await ctx.db.delete(row._id);
      counts.sessions += 1;
    }

    return counts;
  },
});
