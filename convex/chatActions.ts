import { v } from "convex/values";
import { listUIMessages } from "@convex-dev/agent";
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";
import { carterAgent } from "./carterAgent";

function messageHasOfferReplyChoices(message: {
  role?: string;
  parts?: unknown;
}): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) {
    return false;
  }
  for (const part of message.parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.toolName === "offerReplyChoices") return true;
    if (
      typeof record.type === "string" &&
      record.type === "tool-offerReplyChoices"
    ) {
      return true;
    }
  }
  return false;
}

export const generateReply = internalAction({
  args: {
    sessionId: v.id("sessions"),
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Only force reply chips on the first clarifying turn in a thread.
    // After that, Carter should proceed with search instead of re-prompting.
    const prior = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { numItems: 50, cursor: null },
    });
    const alreadyClarified = prior.page.some(messageHasOfferReplyChoices);

    await carterAgent.streamText(
      { ...ctx, sessionId: args.sessionId },
      { threadId: args.threadId },
      {
        promptMessageId: args.promptMessageId,
        ...(alreadyClarified
          ? {}
          : {
              toolChoice: {
                type: "tool" as const,
                toolName: "offerReplyChoices",
              },
            }),
      },
      { saveStreamDeltas: true },
    );
    return null;
  },
});
