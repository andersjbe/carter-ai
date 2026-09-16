import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    userId: v.string(),
    threadId: v.optional(v.string()),
    profileId: v.optional(v.id("profiles")),
    title: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    /** True until the user sends the first message (at most one empty session per user). */
    isEmpty: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_empty", ["userId", "isEmpty"]),

  profiles: defineTable({
    sessionId: v.id("sessions"),
    email: v.optional(v.string()),
    summary: v.optional(v.string()),
    prefs: v.optional(
      v.object({
        budgetMin: v.optional(v.number()),
        budgetMax: v.optional(v.number()),
        categories: v.optional(v.array(v.string())),
        styles: v.optional(v.array(v.string())),
        brandsAvoid: v.optional(v.array(v.string())),
        brandsPrefer: v.optional(v.array(v.string())),
        constraints: v.optional(v.array(v.string())),
        useCases: v.optional(v.array(v.string())),
        urgency: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  }).index("by_session", ["sessionId"]),

  /** User-level defaults for new open-query search scope. */
  userSearchPrefs: defineTable({
    userId: v.string(),
    sources: v.optional(
      v.array(
        v.union(v.literal("amazon"), v.literal("etsy"), v.literal("web")),
      ),
    ),
    customDomains: v.optional(v.array(v.string())),
  }).index("by_user", ["userId"]),

  openQueries: defineTable({
    sessionId: v.id("sessions"),
    profileId: v.optional(v.id("profiles")),
    title: v.string(),
    brief: v.string(),
    searchHints: v.optional(v.array(v.string())),
    sources: v.optional(
      v.array(
        v.union(v.literal("amazon"), v.literal("etsy"), v.literal("web")),
      ),
    ),
    /** Extra hostnames to include in Firecrawl search (e.g. wayfair.com). */
    customDomains: v.optional(v.array(v.string())),
    /** Set when discoverMarketplaces has already been offered for this query. */
    storeDiscoveryOfferedAt: v.optional(v.number()),
    status: v.union(
      v.literal("gathering"),
      v.literal("active"),
      v.literal("paused"),
    ),
    /** 0 = never checked; used for fair cron ordering. */
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_status", ["status"])
    .index("by_status_and_last_checked", ["status", "lastCheckedAt"]),

  findings: defineTable({
    queryId: v.id("openQueries"),
    sessionId: v.id("sessions"),
    title: v.string(),
    url: v.string(),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    source: v.union(
      v.literal("amazon"),
      v.literal("etsy"),
      v.literal("web"),
    ),
    summary: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    fingerprint: v.string(),
    seenAt: v.number(),
    isNew: v.boolean(),
    /** Soft-keep liked or hide-from-UI rejected; undefined = undecided. */
    verdict: v.optional(
      v.union(v.literal("accepted"), v.literal("rejected")),
    ),
    verdictAt: v.optional(v.number()),
  })
    .index("by_query", ["queryId"])
    .index("by_session", ["sessionId"])
    .index("by_query_fingerprint", ["queryId", "fingerprint"])
    .index("by_session_and_verdict", ["sessionId", "verdict"]),

  shoppingLists: defineTable({
    userId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
    /** Denormalized count; maintained on add/remove. */
    itemCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  shoppingListItems: defineTable({
    listId: v.id("shoppingLists"),
    userId: v.string(),
    findingId: v.optional(v.id("findings")),
    title: v.string(),
    url: v.string(),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    source: v.union(
      v.literal("amazon"),
      v.literal("etsy"),
      v.literal("web"),
    ),
    imageUrl: v.optional(v.string()),
    fingerprint: v.string(),
    lastCheckedAt: v.optional(v.number()),
    addedAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_fingerprint", ["listId", "fingerprint"])
    .index("by_user", ["userId"]),

  alertPrefs: defineTable({
    listId: v.id("shoppingLists"),
    enabled: v.boolean(),
    email: v.optional(v.string()),
    /** 0 = never emailed; used for fair cron ordering. */
    lastEmailedAt: v.optional(v.number()),
    agentInboxId: v.optional(v.string()),
  })
    .index("by_list", ["listId"])
    .index("by_enabled_and_last_emailed", ["enabled", "lastEmailedAt"]),

  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
