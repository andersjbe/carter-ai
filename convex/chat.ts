import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

async function assertSessionThread(
  ctx: { db: { get: (id: Id<"sessions">) => Promise<{ threadId?: string } | null> } },
  sessionId: Id<"sessions">,
  threadId: string,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.threadId !== threadId) {
    throw new Error("Unauthorized thread access");
  }
  return session;
}

export const listMessages = query({
  args: {
    sessionId: v.id("sessions"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await assertSessionThread(ctx, args.sessionId, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

export const sendMessage = mutation({
  args: {
    sessionId: v.id("sessions"),
    threadId: v.string(),
    prompt: v.string(),
  },
  returns: v.object({ messageId: v.string() }),
  handler: async (ctx, args) => {
    await assertSessionThread(ctx, args.sessionId, args.threadId);
    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Message cannot be empty");

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt,
    });

    await ctx.scheduler.runAfter(0, internal.chatActions.generateReply, {
      sessionId: args.sessionId,
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});
