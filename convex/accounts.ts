import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { carterAgent } from "./carterAgent";

async function deleteBySession(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
) {
  for (const table of ["findings", "openQueries", "profiles"] as const) {
    while (true) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .take(100);
      if (rows.length === 0) break;
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }
  }
}

async function deleteShoppingData(ctx: MutationCtx, userId: string) {
  const lists = await ctx.db
    .query("shoppingLists")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(200);

  for (const list of lists) {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", list._id))
      .unique();
    if (prefs) {
      await ctx.db.delete(prefs._id);
    }

    while (true) {
      const items = await ctx.db
        .query("shoppingListItems")
        .withIndex("by_list", (q) => q.eq("listId", list._id))
        .take(100);
      if (items.length === 0) break;
      for (const item of items) {
        await ctx.db.delete(item._id);
      }
    }

    await ctx.db.delete(list._id);
  }
}

/** Wipe all Carter app data for a Better Auth user (sessions, lists, prefs). */
export const purgeUserData = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(200);

    for (const session of sessions) {
      await deleteBySession(ctx, session._id);
      if (typeof session.threadId === "string" && session.threadId.length > 0) {
        await carterAgent.deleteThreadAsync(ctx, { threadId: session.threadId });
      }
      await ctx.db.delete(session._id);
    }

    await deleteShoppingData(ctx, args.userId);

    const searchPrefs = await ctx.db
      .query("userSearchPrefs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (searchPrefs) {
      await ctx.db.delete(searchPrefs._id);
    }

    return null;
  },
});
