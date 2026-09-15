import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import type { Id } from "./_generated/dataModel";
import { requireAuthUserId, requireVerifiedAuthEmail } from "./lib/sessionAuth";

const agentmail = new AgentMail(components.agentmail);

async function requireOwnedList(
  ctx: QueryCtx | MutationCtx,
  listId: Id<"shoppingLists">,
) {
  const userId = await requireAuthUserId(ctx);
  const list = await ctx.db.get(listId);
  if (!list || list.userId !== userId) {
    throw new Error("Shopping list not found");
  }
  return { userId, list };
}

export const getPrefs = query({
  args: { listId: v.id("shoppingLists") },
  returns: v.union(
    v.object({
      enabled: v.boolean(),
      email: v.union(v.string(), v.null()),
      lastEmailedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireOwnedList(ctx, args.listId);
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();
    if (!prefs) return null;
    return {
      enabled: prefs.enabled,
      email: prefs.email ?? null,
      lastEmailedAt: prefs.lastEmailedAt ?? null,
    };
  },
});

export const setAlerts = mutation({
  args: {
    listId: v.id("shoppingLists"),
    enabled: v.boolean(),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedList(ctx, args.listId);
    const email = args.email?.trim().toLowerCase();
    if (args.enabled) {
      await requireVerifiedAuthEmail(ctx);
      if (!email || !email.includes("@")) {
        throw new Error("Email is required to enable alerts.");
      }
    }

    const existing = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        email: email ?? existing.email,
      });
    } else {
      await ctx.db.insert("alertPrefs", {
        listId: args.listId,
        enabled: args.enabled,
        email,
      });
    }

    return null;
  },
});

export const getAlertInternal = internalQuery({
  args: { listId: v.id("shoppingLists") },
  returns: v.union(
    v.object({
      enabled: v.boolean(),
      email: v.union(v.string(), v.null()),
      agentInboxId: v.union(v.string(), v.null()),
      lastEmailedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();
    if (!prefs) return null;
    return {
      enabled: prefs.enabled,
      email: prefs.email ?? null,
      agentInboxId: prefs.agentInboxId ?? null,
      lastEmailedAt: prefs.lastEmailedAt ?? null,
    };
  },
});

export const saveInboxId = internalMutation({
  args: {
    listId: v.id("shoppingLists"),
    agentInboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();
    if (prefs) {
      await ctx.db.patch(prefs._id, { agentInboxId: args.agentInboxId });
    }
    return null;
  },
});

export const markEmailed = internalMutation({
  args: { listId: v.id("shoppingLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();
    if (prefs) {
      await ctx.db.patch(prefs._id, { lastEmailedAt: Date.now() });
    }
    return null;
  },
});

export const getOrCreateAgentInbox = internalAction({
  args: { listId: v.id("shoppingLists") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const prefs: {
      enabled: boolean;
      email: string | null;
      agentInboxId: string | null;
      lastEmailedAt: number | null;
    } | null = await ctx.runQuery(internal.mail.getAlertInternal, {
      listId: args.listId,
    });
    if (prefs?.agentInboxId) return prefs.agentInboxId;

    const shared: string | null = await ctx.runQuery(
      internal.mail.getSharedInbox,
      {},
    );
    if (shared) {
      await ctx.runMutation(internal.mail.saveInboxId, {
        listId: args.listId,
        agentInboxId: shared,
      });
      return shared;
    }

    const inbox = await agentmail.createInbox(ctx, {
      username: `carter-${args.listId.slice(-8)}`,
      displayName: "Carter Product Scout",
    });
    const inboxId = String(inbox.inbox_id ?? inbox.id ?? inbox.inboxId);
    await ctx.runMutation(internal.mail.setSharedInbox, { inboxId });
    await ctx.runMutation(internal.mail.saveInboxId, {
      listId: args.listId,
      agentInboxId: inboxId,
    });
    return inboxId;
  },
});

export const getSharedInbox = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "agentmail_inbox_id"))
      .unique();
    return row?.value ?? null;
  },
});

export const setSharedInbox = internalMutation({
  args: { inboxId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "agentmail_inbox_id"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.inboxId });
    } else {
      await ctx.db.insert("appConfig", {
        key: "agentmail_inbox_id",
        value: args.inboxId,
      });
    }
    return null;
  },
});

export const sendDigest = internalMutation({
  args: {
    listId: v.id("shoppingLists"),
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await agentmail.sendMessage(ctx, args.inboxId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
      labels: ["carter-digest", "product-alert"],
    });
    await ctx.runMutation(internal.mail.markEmailed, {
      listId: args.listId,
    });
    return null;
  },
});

/** Auth transactional email (password reset / verification) via shared AgentMail inbox. */
export const sendAuthEmail = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let inboxId: string | null = await ctx.runQuery(
      internal.mail.getSharedInbox,
      {},
    );
    if (!inboxId) {
      const inbox = await agentmail.createInbox(ctx, {
        username: "carter-auth",
        displayName: "Carter Auth",
      });
      inboxId = String(inbox.inbox_id ?? inbox.id ?? inbox.inboxId);
      await ctx.runMutation(internal.mail.setSharedInbox, { inboxId });
    }
    await ctx.runMutation(internal.mail.deliverAuthEmail, {
      inboxId,
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    return null;
  },
});

export const deliverAuthEmail = internalMutation({
  args: {
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await agentmail.sendMessage(ctx, args.inboxId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
      labels: ["carter-auth"],
    });
    return null;
  },
});
