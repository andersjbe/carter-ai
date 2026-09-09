import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { carterAgent } from "./carterAgent";

export const generateReply = internalAction({
  args: {
    sessionId: v.id("sessions"),
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await carterAgent.streamText(
      { ...ctx, sessionId: args.sessionId },
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: true },
    );
    return null;
  },
});
