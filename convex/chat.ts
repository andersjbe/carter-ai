import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  listUIMessages,
  saveMessage,
  syncStreams,
  updateThreadMetadata,
  vStreamArgs,
} from "@convex-dev/agent";
import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { requireOwnedSession } from "./lib/sessionAuth";
import {
  sessionIsEmpty,
  titleFromPrompt,
} from "./lib/sessionTitle";

export const listMessages = query({
  args: {
    sessionId: v.id("sessions"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const session = await requireOwnedSession(ctx, args.sessionId);
    if (session.threadId !== args.threadId) {
      throw new Error("Unauthorized thread access");
    }
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
    const session = await requireOwnedSession(ctx, args.sessionId);
    if (session.threadId !== args.threadId) {
      throw new Error("Unauthorized thread access");
    }
    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Message cannot be empty");

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt,
    });

    const updatedAt = Date.now();
    const patch: {
      updatedAt: number;
      isEmpty: false;
      title?: string;
    } = { updatedAt, isEmpty: false };

    if (sessionIsEmpty(session)) {
      const title = titleFromPrompt(prompt);
      patch.title = title;
      await updateThreadMetadata(ctx, components.agent, {
        threadId: args.threadId,
        patch: { title },
      });
    }
    await ctx.db.patch(args.sessionId, patch);

    await ctx.scheduler.runAfter(0, internal.chatActions.generateReply, {
      sessionId: args.sessionId,
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});
