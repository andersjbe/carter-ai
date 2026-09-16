import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

type DbCtx = QueryCtx | MutationCtx;

export async function requireAuthUserId(ctx: DbCtx): Promise<string> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user._id;
}

/** Require a signed-in user whose auth email is verified (Google or email link). */
export async function requireVerifiedAuthEmail(
  ctx: DbCtx,
): Promise<{ userId: string; email: string }> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  if (!user.emailVerified) {
    throw new Error("Verify your email before using email alerts or profile email.");
  }
  return { userId: user._id, email: user.email };
}

export async function requireOwnedSession(
  ctx: DbCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"sessions">> {
  const userId = await requireAuthUserId(ctx);
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Unauthorized");
  }
  return session;
}

/** Ensure an open query belongs to the given session (agent / internal writers). */
export async function requireQueryForSession(
  ctx: DbCtx,
  queryId: Id<"openQueries">,
  sessionId: Id<"sessions">,
): Promise<Doc<"openQueries">> {
  const openQuery = await ctx.db.get(queryId);
  if (!openQuery || openQuery.sessionId !== sessionId) {
    throw new Error("Open query not found");
  }
  return openQuery;
}
