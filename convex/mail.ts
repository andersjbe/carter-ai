import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { requireOwnedSession } from "./lib/sessionAuth";

const agentmail = new AgentMail(components.agentmail);

export const getPrefs = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      enabled: v.boolean(),
      email: v.union(v.string(), v.null()),
      lastEmailedAt: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
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
    sessionId: v.id("sessions"),
    enabled: v.boolean(),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedSession(ctx, args.sessionId);
    const email = args.email?.trim().toLowerCase();
    if (args.enabled && (!email || !email.includes("@"))) {
      throw new Error("Email is required to enable alerts.");
    }

    const existing = await ctx.db
      .query("alertPrefs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        email: email ?? existing.email,
      });
    } else {
      await ctx.db.insert("alertPrefs", {
        sessionId: args.sessionId,
        enabled: args.enabled,
        email,
      });
    }

    if (email) {
      await ctx.runMutation(internal.profiles.upsertPreferences, {
        sessionId: args.sessionId,
        email,
      });
    }

    return null;
  },
});

export const setAlertsInternal = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    enabled: v.boolean(),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email?.trim().toLowerCase();
    const existing = await ctx.db
      .query("alertPrefs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        email: email ?? existing.email,
      });
    } else {
      await ctx.db.insert("alertPrefs", {
        sessionId: args.sessionId,
        enabled: args.enabled,
        email,
      });
    }
    if (email) {
      await ctx.runMutation(internal.profiles.upsertPreferences, {
        sessionId: args.sessionId,
        email,
      });
    }
    return null;
  },
});

export const getAlertInternal = internalQuery({
  args: { sessionId: v.id("sessions") },
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
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
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
    sessionId: v.id("sessions"),
    agentInboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (prefs) {
      await ctx.db.patch(prefs._id, { agentInboxId: args.agentInboxId });
    }
    return null;
  },
});

export const markEmailed = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (prefs) {
      await ctx.db.patch(prefs._id, { lastEmailedAt: Date.now() });
    }
    return null;
  },
});

export const getOrCreateAgentInbox = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const prefs: {
      enabled: boolean;
      email: string | null;
      agentInboxId: string | null;
      lastEmailedAt: number | null;
    } | null = await ctx.runQuery(internal.mail.getAlertInternal, {
      sessionId: args.sessionId,
    });
    if (prefs?.agentInboxId) return prefs.agentInboxId;

    const shared: string | null = await ctx.runQuery(
      internal.mail.getSharedInbox,
      {},
    );
    if (shared) {
      await ctx.runMutation(internal.mail.saveInboxId, {
        sessionId: args.sessionId,
        agentInboxId: shared,
      });
      return shared;
    }

    const inbox = await agentmail.createInbox(ctx, {
      username: `carter-${args.sessionId.slice(-8)}`,
      displayName: "Carter Product Scout",
    });
    const inboxId = String(inbox.inbox_id ?? inbox.id ?? inbox.inboxId);
    await ctx.runMutation(internal.mail.setSharedInbox, { inboxId });
    await ctx.runMutation(internal.mail.saveInboxId, {
      sessionId: args.sessionId,
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
    sessionId: v.id("sessions"),
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
      sessionId: args.sessionId,
    });
    return null;
  },
});
