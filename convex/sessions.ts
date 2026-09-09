import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { createThread } from "@convex-dev/agent";

export const getOrCreate = mutation({
  args: { clientKey: v.string() },
  returns: v.object({
    sessionId: v.id("sessions"),
    threadId: v.string(),
    profileId: v.union(v.id("profiles"), v.null()),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", args.clientKey))
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
      clientKey: args.clientKey,
      threadId,
    });

    return { sessionId, threadId, profileId: null };
  },
});

export const getByClientKey = query({
  args: { clientKey: v.string() },
  returns: v.union(
    v.object({
      sessionId: v.id("sessions"),
      threadId: v.union(v.string(), v.null()),
      profileId: v.union(v.id("profiles"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_clientKey", (q) => q.eq("clientKey", args.clientKey))
      .unique();
    if (!session) return null;
    return {
      sessionId: session._id,
      threadId: session.threadId ?? null,
      profileId: session.profileId ?? null,
    };
  },
});
