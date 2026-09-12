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
