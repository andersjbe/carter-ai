import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const recheckOpenQueries = internalAction({
  args: {},
  returns: v.object({
    checked: v.number(),
    emailed: v.number(),
  }),
  handler: async (ctx) => {
    const active = await ctx.runQuery(internal.openQueries.listActive, {});
    let checked = 0;
    let emailed = 0;

    for (const query of active) {
      checked += 1;
      const hints =
        query.searchHints && query.searchHints.length > 0
          ? query.searchHints.slice(0, 2)
          : [query.title];

      for (const hint of hints) {
        const sources = query.sources ?? ["web"];
        for (const source of sources.slice(0, 2)) {
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
            });
          } catch (error) {
            console.error("Firecrawl recheck failed", error);
          }
        }
      }

      const fresh = await ctx.runQuery(internal.findings.listNewForQuery, {
        queryId: query._id,
      });
      if (fresh.length === 0) continue;

      const alerts = await ctx.runQuery(internal.mail.getAlertInternal, {
        sessionId: query.sessionId,
      });
      if (!alerts?.enabled || !alerts.email) continue;

      // Avoid spamming more than once per 6 hours per session.
      if (
        alerts.lastEmailedAt &&
        Date.now() - alerts.lastEmailedAt < 6 * 60 * 60 * 1000
      ) {
        continue;
      }

      try {
        const inboxId = await ctx.runAction(internal.mail.getOrCreateAgentInbox, {
          sessionId: query.sessionId,
        });
        const lines = fresh
          .slice(0, 8)
          .map(
            (item: {
              title: string;
              url: string;
              price: number | null;
              currency: string | null;
            }) => {
            const price =
              item.price != null
                ? ` — ${item.currency ?? "USD"} ${item.price}`
                : "";
            return `• ${item.title}${price}\n  ${item.url}`;
          },
          )
          .join("\n\n");

        await ctx.runMutation(internal.mail.sendDigest, {
          sessionId: query.sessionId,
          inboxId,
          to: alerts.email,
          subject: `Carter found new products for “${query.title}”`,
          text: `Hi — Carter spotted new or updated items related to your open query “${query.title}”.\n\n${lines}\n\nOpen Carter to refine your brief or pause alerts.`,
        });
        await ctx.runMutation(internal.findings.markSeen, {
          queryId: query._id,
        });
        emailed += 1;
      } catch (error) {
        console.error("AgentMail digest failed", error);
      }
    }

    return { checked, emailed };
  },
});
