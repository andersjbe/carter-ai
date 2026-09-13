import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** Skip rechecks that ran within this window (matches cron cadence). */
const MIN_RECHECK_GAP_MS = 6 * 60 * 60 * 1000;
/** Max list items to scrape per list per run (credits). */
const MAX_ITEMS_PER_LIST = 8;

/** Refresh open-query findings for the UI — no email. */
export const recheckOpenQueries = internalAction({
  args: {},
  returns: v.object({
    checked: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const active = await ctx.runQuery(internal.openQueries.listActive, {});
    let checked = 0;
    let skipped = 0;
    const now = Date.now();

    for (const query of active) {
      if (
        query.lastCheckedAt &&
        now - query.lastCheckedAt < MIN_RECHECK_GAP_MS
      ) {
        skipped += 1;
        continue;
      }

      checked += 1;
      const hint =
        query.searchHints && query.searchHints.length > 0
          ? query.searchHints[0]!
          : query.title;
      const sources = query.sources ?? ["web"];
      const source = sources[0] ?? "web";

      const includeDomains =
        source === "amazon"
          ? ["amazon.com"]
          : source === "etsy"
            ? ["etsy.com"]
            : undefined;
      const searchQuery =
        source === "amazon"
          ? `${hint} site:amazon.com`
          : source === "etsy"
            ? `${hint} site:etsy.com`
            : hint;

      try {
        await ctx.runAction(internal.firecrawl.searchAndStore, {
          sessionId: query.sessionId,
          queryId: query._id,
          searchQuery,
          includeDomains,
          limit: 4,
          enrichNew: false,
        });
      } catch (error) {
        console.error("Firecrawl recheck failed", error);
      }
    }

    return { checked, skipped };
  },
});

/** Price-drop digests for shopping lists with alerts enabled. */
export const recheckShoppingListPrices = internalAction({
  args: {},
  returns: v.object({
    listsChecked: v.number(),
    emailed: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const lists = await ctx.runQuery(
      internal.shoppingLists.listAlertEnabled,
      {},
    );
    let listsChecked = 0;
    let emailed = 0;
    let skipped = 0;
    const now = Date.now();

    for (const list of lists) {
      if (
        list.lastEmailedAt &&
        now - list.lastEmailedAt < MIN_RECHECK_GAP_MS
      ) {
        skipped += 1;
        continue;
      }

      listsChecked += 1;
      const items = await ctx.runQuery(
        internal.shoppingLists.listItemsForDigest,
        { listId: list.listId },
      );

      const drops: Array<{
        title: string;
        url: string;
        oldPrice: number;
        newPrice: number;
        currency: string | null;
      }> = [];

      for (const item of items.slice(0, MAX_ITEMS_PER_LIST)) {
        if (
          item.lastCheckedAt &&
          now - item.lastCheckedAt < MIN_RECHECK_GAP_MS
        ) {
          continue;
        }

        let scraped: {
          title: string | null;
          price: number | null;
          currency: string | null;
        };
        try {
          scraped = await ctx.runAction(internal.firecrawl.scrapePriceOnly, {
            url: item.url,
          });
        } catch (error) {
          console.error("List item scrape failed", item.url, error);
          continue;
        }

        const newPrice = scraped.price;
        await ctx.runMutation(internal.shoppingLists.patchItemPrice, {
          itemId: item._id as Id<"shoppingListItems">,
          price: newPrice ?? undefined,
          currency: scraped.currency ?? undefined,
          title: scraped.title ?? undefined,
        });

        if (
          item.price != null &&
          newPrice != null &&
          newPrice < item.price
        ) {
          drops.push({
            title: scraped.title ?? item.title,
            url: item.url,
            oldPrice: item.price,
            newPrice,
            currency: scraped.currency ?? item.currency,
          });
        }
      }

      if (drops.length === 0) continue;

      try {
        const inboxId = await ctx.runAction(
          internal.mail.getOrCreateAgentInbox,
          { listId: list.listId },
        );
        const lines = drops
          .slice(0, 8)
          .map((item) => {
            const cur = item.currency ?? "USD";
            return `• ${item.title}\n  ${cur} ${item.oldPrice} → ${cur} ${item.newPrice}\n  ${item.url}`;
          })
          .join("\n\n");

        await ctx.runMutation(internal.mail.sendDigest, {
          listId: list.listId,
          inboxId,
          to: list.email,
          subject: `Price drop on “${list.name}”`,
          text: `Hi — Carter spotted price drops on items in your shopping list “${list.name}”.\n\n${lines}\n\nOpen Carter → Lists to manage this list or pause alerts.`,
        });
        emailed += 1;
      } catch (error) {
        console.error("List price digest failed", error);
      }
    }

    return { listsChecked, emailed, skipped };
  },
});
