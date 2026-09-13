import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuthUserId } from "./lib/sessionAuth";

const sourceValidator = v.union(
  v.literal("amazon"),
  v.literal("etsy"),
  v.literal("web"),
);

const listSummaryValidator = v.object({
  _id: v.id("shoppingLists"),
  name: v.string(),
  updatedAt: v.number(),
  itemCount: v.number(),
});

const listItemValidator = v.object({
  _id: v.id("shoppingListItems"),
  listId: v.id("shoppingLists"),
  findingId: v.union(v.id("findings"), v.null()),
  title: v.string(),
  url: v.string(),
  price: v.union(v.number(), v.null()),
  currency: v.union(v.string(), v.null()),
  source: sourceValidator,
  imageUrl: v.union(v.string(), v.null()),
  addedAt: v.number(),
  lastCheckedAt: v.union(v.number(), v.null()),
});

function fingerprint(url: string, title: string) {
  return `${url.trim().toLowerCase()}|${title.trim().toLowerCase()}`.slice(
    0,
    400,
  );
}

function mapItem(item: Doc<"shoppingListItems">) {
  return {
    _id: item._id,
    listId: item.listId,
    findingId: item.findingId ?? null,
    title: item.title,
    url: item.url,
    price: item.price ?? null,
    currency: item.currency ?? null,
    source: item.source,
    imageUrl: item.imageUrl ?? null,
    addedAt: item.addedAt,
    lastCheckedAt: item.lastCheckedAt ?? null,
  };
}

async function requireOwnedList(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  listId: Id<"shoppingLists">,
): Promise<Doc<"shoppingLists">> {
  const list = await ctx.db.get(listId);
  if (!list || list.userId !== userId) {
    throw new Error("Shopping list not found");
  }
  return list;
}

export const listMine = query({
  args: {},
  returns: v.array(listSummaryValidator),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const lists = await ctx.db
      .query("shoppingLists")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    const result = [];
    for (const list of lists) {
      const items = await ctx.db
        .query("shoppingListItems")
        .withIndex("by_list", (q) => q.eq("listId", list._id))
        .collect();
      result.push({
        _id: list._id,
        name: list.name,
        updatedAt: list.updatedAt,
        itemCount: items.length,
      });
    }
    return result;
  },
});

export const get = query({
  args: { listId: v.id("shoppingLists") },
  returns: v.union(
    v.object({
      _id: v.id("shoppingLists"),
      name: v.string(),
      updatedAt: v.number(),
      items: v.array(listItemValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const list = await ctx.db.get(args.listId);
    if (!list || list.userId !== userId) {
      return null;
    }
    const items = await ctx.db
      .query("shoppingListItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    items.sort((a, b) => b.addedAt - a.addedAt);
    return {
      _id: list._id,
      name: list.name,
      updatedAt: list.updatedAt,
      items: items.map(mapItem),
    };
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.id("shoppingLists"),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("List name is required");
    }
    return await ctx.db.insert("shoppingLists", {
      userId,
      name: name.slice(0, 120),
      updatedAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: {
    listId: v.id("shoppingLists"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    await requireOwnedList(ctx, userId, args.listId);
    const name = args.name.trim();
    if (!name) {
      throw new Error("List name is required");
    }
    await ctx.db.patch(args.listId, {
      name: name.slice(0, 120),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { listId: v.id("shoppingLists") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    await requireOwnedList(ctx, userId, args.listId);

    const items = await ctx.db
      .query("shoppingListItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    const prefs = await ctx.db
      .query("alertPrefs")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .unique();
    if (prefs) {
      await ctx.db.delete(prefs._id);
    }

    await ctx.db.delete(args.listId);
    return null;
  },
});

export const addItem = mutation({
  args: {
    listId: v.id("shoppingLists"),
    findingId: v.optional(v.id("findings")),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    source: v.optional(sourceValidator),
    imageUrl: v.optional(v.string()),
  },
  returns: v.id("shoppingListItems"),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    await requireOwnedList(ctx, userId, args.listId);

    let title: string;
    let url: string;
    let price: number | undefined;
    let currency: string | undefined;
    let source: "amazon" | "etsy" | "web";
    let imageUrl: string | undefined;
    let findingId: Id<"findings"> | undefined;

    if (args.findingId) {
      const finding = await ctx.db.get(args.findingId);
      if (!finding) {
        throw new Error("Finding not found");
      }
      const session = await ctx.db.get(finding.sessionId);
      if (!session || session.userId !== userId) {
        throw new Error("Unauthorized");
      }
      title = finding.title;
      url = finding.url;
      price = finding.price;
      currency = finding.currency;
      source = finding.source;
      imageUrl = finding.imageUrl;
      findingId = finding._id;
    } else {
      if (!args.title?.trim() || !args.url?.trim() || !args.source) {
        throw new Error("Product details are required");
      }
      title = args.title.trim();
      url = args.url.trim();
      price = args.price;
      currency = args.currency;
      source = args.source;
      imageUrl = args.imageUrl;
    }

    const fp = fingerprint(url, title);
    const existing = await ctx.db
      .query("shoppingListItems")
      .withIndex("by_list_fingerprint", (q) =>
        q.eq("listId", args.listId).eq("fingerprint", fp),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(args.listId, { updatedAt: Date.now() });
      return existing._id;
    }

    const itemId = await ctx.db.insert("shoppingListItems", {
      listId: args.listId,
      userId,
      findingId,
      title: title.slice(0, 200),
      url,
      price,
      currency,
      source,
      imageUrl,
      fingerprint: fp,
      addedAt: Date.now(),
    });
    await ctx.db.patch(args.listId, { updatedAt: Date.now() });
    return itemId;
  },
});

export const removeItem = mutation({
  args: { itemId: v.id("shoppingListItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }
    await ctx.db.delete(args.itemId);
    await ctx.db.patch(item.listId, { updatedAt: Date.now() });
    return null;
  },
});

/** Lists with alerts enabled (for price-drop digests). */
export const listAlertEnabled = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      listId: v.id("shoppingLists"),
      name: v.string(),
      email: v.string(),
      lastEmailedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const prefs = await ctx.db.query("alertPrefs").take(100);
    const result: Array<{
      listId: Id<"shoppingLists">;
      name: string;
      email: string;
      lastEmailedAt: number | null;
    }> = [];
    for (const pref of prefs) {
      if (!pref.enabled || !pref.email) continue;
      const list = await ctx.db.get(pref.listId);
      if (!list) continue;
      result.push({
        listId: list._id,
        name: list.name,
        email: pref.email,
        lastEmailedAt: pref.lastEmailedAt ?? null,
      });
    }
    return result;
  },
});

export const listItemsForDigest = internalQuery({
  args: { listId: v.id("shoppingLists") },
  returns: v.array(
    v.object({
      _id: v.id("shoppingListItems"),
      title: v.string(),
      url: v.string(),
      price: v.union(v.number(), v.null()),
      currency: v.union(v.string(), v.null()),
      source: sourceValidator,
      lastCheckedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("shoppingListItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .take(40);
    return items.map((item) => ({
      _id: item._id,
      title: item.title,
      url: item.url,
      price: item.price ?? null,
      currency: item.currency ?? null,
      source: item.source,
      lastCheckedAt: item.lastCheckedAt ?? null,
    }));
  },
});

export const patchItemPrice = internalMutation({
  args: {
    itemId: v.id("shoppingListItems"),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const patch: {
      lastCheckedAt: number;
      price?: number;
      currency?: string;
      title?: string;
    } = { lastCheckedAt: Date.now() };
    if (args.price !== undefined) patch.price = args.price;
    if (args.currency !== undefined) patch.currency = args.currency;
    if (args.title !== undefined) patch.title = args.title.slice(0, 200);
    await ctx.db.patch(args.itemId, patch);
    return null;
  },
});
