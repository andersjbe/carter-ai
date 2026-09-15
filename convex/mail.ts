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
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { requireAuthUserId, requireVerifiedAuthEmail } from "./lib/sessionAuth";

const AGENTMAIL_DEFAULT_BASE = "https://api.agentmail.to/v0";

/**
 * Call AgentMail's HTTP API from the *parent* app.
 *
 * Convex components are isolated from app env vars, so `@agentmail/convex`'s
 * internal createInbox / performSend cannot see AGENTMAIL_API_KEY. Auth and
 * digest mail therefore use this helper from parent actions instead.
 */
async function agentMailFetch(
  path: string,
  init: { method: string; body?: Record<string, unknown> },
): Promise<unknown> {
  const apiKey = env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is not set on the Convex deployment. Run `npx convex env set AGENTMAIL_API_KEY <key>`.",
    );
  }
  const baseUrl = (env.AGENTMAIL_BASE_URL ?? AGENTMAIL_DEFAULT_BASE).replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `AgentMail ${init.method} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return await response.json();
}

async function createAgentMailInbox(args: {
  displayName: string;
  username?: string;
}): Promise<string> {
  const body: Record<string, string> = {
    display_name: args.displayName,
  };
  if (args.username) body.username = args.username;

  const inbox = (await agentMailFetch("/inboxes", {
    method: "POST",
    body,
  })) as {
    inbox_id?: string;
    id?: string;
    inboxId?: string;
  } | null;
  const inboxId = String(
    inbox?.inbox_id ?? inbox?.id ?? inbox?.inboxId ?? "",
  ).trim();
  if (!inboxId) {
    throw new Error("AgentMail createInbox returned no inbox id");
  }
  return inboxId;
}

async function sendAgentMailMessage(args: {
  inboxId: string;
  to: string;
  subject: string;
  text: string;
  labels?: string[];
}): Promise<void> {
  await agentMailFetch(`/inboxes/${args.inboxId}/messages/send`, {
    method: "POST",
    body: {
      to: args.to,
      subject: args.subject,
      text: args.text,
      labels: args.labels,
    },
  });
}

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

    const inboxId = await createAgentMailInbox({
      displayName: "Carter Product Scout",
      username: `carter-${args.listId.slice(-8)}`,
    });
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

export const sendDigest = internalAction({
  args: {
    listId: v.id("shoppingLists"),
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sendAgentMailMessage({
      inboxId: args.inboxId,
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
    try {
      let inboxId: string | null = await ctx.runQuery(
        internal.mail.getSharedInbox,
        {},
      );
      if (!inboxId) {
        inboxId = await createAgentMailInbox({
          displayName: "Carter Auth",
        });
        await ctx.runMutation(internal.mail.setSharedInbox, { inboxId });
      }
      await sendAgentMailMessage({
        inboxId,
        to: args.to,
        subject: args.subject,
        text: args.text,
        labels: ["carter-auth"],
      });
      return null;
    } catch (error) {
      console.error("sendAuthEmail failed", {
        to: args.to,
        subject: args.subject,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
