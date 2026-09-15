import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { createThread, updateThreadMetadata } from "@convex-dev/agent";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { carterAgent } from "./carterAgent";
import {
  requireAuthUserId,
  requireOwnedSession,
} from "./lib/sessionAuth";
import {
  DEFAULT_SESSION_TITLE,
  MAX_SESSION_TITLE_LENGTH,
  sessionIsEmpty,
} from "./lib/sessionTitle";

const sessionSummary = v.object({
  sessionId: v.id("sessions"),
  threadId: v.string(),
  title: v.string(),
  updatedAt: v.number(),
  isEmpty: v.boolean(),
  profileId: v.union(v.id("profiles"), v.null()),
});

function sessionSortKey(session: Doc<"sessions">): number {
  return session.updatedAt ?? session._creationTime;
}

function toSummary(session: Doc<"sessions"> & { threadId: string }) {
  return {
    sessionId: session._id,
    threadId: session.threadId,
    title: session.title?.trim() || DEFAULT_SESSION_TITLE,
    updatedAt: sessionSortKey(session),
    isEmpty: sessionIsEmpty(session),
    profileId: session.profileId ?? null,
  };
}

async function findEmptySession(
  ctx: MutationCtx,
  userId: string,
): Promise<(Doc<"sessions"> & { threadId: string }) | null> {
  const indexed = await ctx.db
    .query("sessions")
    .withIndex("by_user_empty", (q) =>
      q.eq("userId", userId).eq("isEmpty", true),
    )
    .take(10);

  const withThread = indexed.filter(
    (session): session is Doc<"sessions"> & { threadId: string } =>
      typeof session.threadId === "string" && session.threadId.length > 0,
  );
  if (withThread[0]) return withThread[0];

  // Legacy rows may lack isEmpty — fall back to title heuristic.
  const all = await ctx.db
    .query("sessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(100);

  const emptyLegacy = all
    .filter(
      (session): session is Doc<"sessions"> & { threadId: string } =>
        typeof session.threadId === "string" &&
        session.threadId.length > 0 &&
        sessionIsEmpty(session),
    )
    .sort((a, b) => sessionSortKey(b) - sessionSortKey(a));

  return emptyLegacy[0] ?? null;
}

async function createEmptySession(
  ctx: MutationCtx,
  userId: string,
): Promise<{
  sessionId: Id<"sessions">;
  threadId: string;
  profileId: null;
  title: string;
  updatedAt: number;
  isEmpty: true;
}> {
  const updatedAt = Date.now();
  const title = DEFAULT_SESSION_TITLE;
  const threadId = await createThread(ctx, components.agent, {
    title,
    userId,
  });
  const sessionId = await ctx.db.insert("sessions", {
    userId,
    threadId,
    title,
    updatedAt,
    isEmpty: true,
  });
  return {
    sessionId,
    threadId,
    profileId: null,
    title,
    updatedAt,
    isEmpty: true,
  };
}

/** Reuse the sole empty chat if one exists; otherwise create a new empty session. */
export const create = mutation({
  args: {},
  returns: sessionSummary,
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const existingEmpty = await findEmptySession(ctx, userId);
    if (existingEmpty) {
      const updatedAt = Date.now();
      await ctx.db.patch(existingEmpty._id, {
        updatedAt,
        isEmpty: true,
        title: existingEmpty.title?.trim() || DEFAULT_SESSION_TITLE,
      });
      return toSummary({ ...existingEmpty, updatedAt, isEmpty: true });
    }
    return await createEmptySession(ctx, userId);
  },
});

export const list = query({
  args: {},
  returns: v.array(sessionSummary),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    return sessions
      .filter(
        (session): session is Doc<"sessions"> & { threadId: string } =>
          typeof session.threadId === "string" && session.threadId.length > 0,
      )
      .sort((a, b) => sessionSortKey(b) - sessionSortKey(a))
      .map(toSummary);
  },
});

export const getOrCreate = mutation({
  args: {},
  returns: sessionSummary,
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    const withThread = sessions
      .filter(
        (session): session is Doc<"sessions"> & { threadId: string } =>
          typeof session.threadId === "string" && session.threadId.length > 0,
      )
      .sort((a, b) => sessionSortKey(b) - sessionSortKey(a));

    const latest = withThread[0];
    if (latest) {
      return toSummary(latest);
    }

    const legacy = sessions.sort(
      (a, b) => sessionSortKey(b) - sessionSortKey(a),
    )[0];
    if (legacy) {
      const updatedAt = Date.now();
      const title = legacy.title?.trim() || DEFAULT_SESSION_TITLE;
      const threadId = await createThread(ctx, components.agent, {
        title,
        userId,
      });
      const isEmpty = sessionIsEmpty({ ...legacy, title });
      await ctx.db.patch(legacy._id, {
        threadId,
        title,
        updatedAt,
        isEmpty,
      });
      return {
        sessionId: legacy._id,
        threadId,
        title,
        updatedAt,
        isEmpty,
        profileId: legacy.profileId ?? null,
      };
    }

    return await createEmptySession(ctx, userId);
  },
});

export const getMine = query({
  args: {},
  returns: v.union(sessionSummary, v.null()),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    const latest = sessions
      .filter(
        (session): session is Doc<"sessions"> & { threadId: string } =>
          typeof session.threadId === "string" && session.threadId.length > 0,
      )
      .sort((a, b) => sessionSortKey(b) - sessionSortKey(a))[0];

    if (!latest) return null;
    return toSummary(latest);
  },
});

/** Rename a conversation. Does not change empty/message state. */
export const rename = mutation({
  args: {
    sessionId: v.id("sessions"),
    title: v.string(),
  },
  returns: sessionSummary,
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId);
    if (typeof session.threadId !== "string" || session.threadId.length === 0) {
      throw new Error("Conversation has no thread");
    }

    const title = args.title.trim().slice(0, MAX_SESSION_TITLE_LENGTH);
    if (!title) {
      throw new Error("Title is required");
    }

    const updatedAt = Date.now();
    await ctx.db.patch(args.sessionId, { title, updatedAt });
    await updateThreadMetadata(ctx, components.agent, {
      threadId: session.threadId,
      patch: { title },
    });

    return toSummary({
      ...session,
      threadId: session.threadId,
      title,
      updatedAt,
    });
  },
});

async function deleteSessionScopedRows(
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

/** Delete one conversation and its session-scoped data.
 * Always leaves the user with a valid session (creates one if this was the last). */
export const remove = mutation({
  args: { sessionId: v.id("sessions") },
  returns: sessionSummary,
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId);
    const userId = session.userId;

    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const others = existing
      .filter(
        (row): row is Doc<"sessions"> & { threadId: string } =>
          row._id !== args.sessionId &&
          typeof row.threadId === "string" &&
          row.threadId.length > 0,
      )
      .sort((a, b) => sessionSortKey(b) - sessionSortKey(a));

    // Create a replacement before deleting the last chat so the UI never
    // briefly has zero sessions.
    const replacement =
      others.length === 0 ? await createEmptySession(ctx, userId) : null;

    await deleteSessionScopedRows(ctx, args.sessionId);

    if (typeof session.threadId === "string" && session.threadId.length > 0) {
      await carterAgent.deleteThreadAsync(ctx, { threadId: session.threadId });
    }

    await ctx.db.delete(args.sessionId);

    if (replacement) {
      return {
        sessionId: replacement.sessionId,
        threadId: replacement.threadId,
        title: replacement.title,
        updatedAt: replacement.updatedAt,
        isEmpty: replacement.isEmpty,
        profileId: replacement.profileId,
      };
    }
    return toSummary(others[0]!);
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
    shoppingListItems: v.number(),
    shoppingLists: v.number(),
    alertPrefs: v.number(),
  }),
  handler: async (ctx) => {
    const counts = {
      sessions: 0,
      profiles: 0,
      openQueries: 0,
      findings: 0,
      shoppingListItems: 0,
      shoppingLists: 0,
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
    for (const row of await ctx.db.query("shoppingListItems").take(500)) {
      await ctx.db.delete(row._id);
      counts.shoppingListItems += 1;
    }
    for (const row of await ctx.db.query("alertPrefs").take(500)) {
      await ctx.db.delete(row._id);
      counts.alertPrefs += 1;
    }
    for (const row of await ctx.db.query("shoppingLists").take(500)) {
      await ctx.db.delete(row._id);
      counts.shoppingLists += 1;
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