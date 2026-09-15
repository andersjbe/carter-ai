import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAuthUserId } from "./lib/sessionAuth";
import {
  normalizeCustomDomains,
  type MarketplaceSource,
} from "./lib/searchScope";

const sourceValidator = v.union(
  v.literal("amazon"),
  v.literal("etsy"),
  v.literal("web"),
);

const prefsReturnValidator = v.object({
  sources: v.array(sourceValidator),
  customDomains: v.array(v.string()),
});

const DEFAULT_SOURCES: MarketplaceSource[] = ["amazon", "etsy", "web"];

function dedupeSources(sources: MarketplaceSource[]): MarketplaceSource[] {
  const order: MarketplaceSource[] = ["amazon", "etsy", "web"];
  const set = new Set(sources);
  return order.filter((s) => set.has(s));
}

export const getMine = query({
  args: {},
  returns: prefsReturnValidator,
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const row = await ctx.db
      .query("userSearchPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      sources: row?.sources ?? DEFAULT_SOURCES,
      customDomains: row?.customDomains ?? [],
    };
  },
});

export const updateMine = mutation({
  args: {
    sources: v.array(sourceValidator),
    customDomains: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);
    const customDomains = normalizeCustomDomains(args.customDomains);
    const sources = dedupeSources(args.sources);

    if (sources.length === 0 && customDomains.length === 0) {
      throw new Error(
        "Select at least one marketplace or add a custom domain",
      );
    }

    const existing = await ctx.db
      .query("userSearchPrefs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sources,
        customDomains:
          customDomains.length > 0 ? customDomains : undefined,
      });
    } else {
      await ctx.db.insert("userSearchPrefs", {
        userId,
        sources,
        ...(customDomains.length > 0 ? { customDomains } : {}),
      });
    }
    return null;
  },
});

/** Defaults for a chat session's owner (used when creating open queries). */
export const getForSessionInternal = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: prefsReturnValidator,
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      return { sources: DEFAULT_SOURCES, customDomains: [] };
    }
    const row = await ctx.db
      .query("userSearchPrefs")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .unique();
    return {
      sources: row?.sources ?? DEFAULT_SOURCES,
      customDomains: row?.customDomains ?? [],
    };
  },
});
