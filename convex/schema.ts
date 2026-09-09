import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    clientKey: v.string(),
    threadId: v.optional(v.string()),
    profileId: v.optional(v.id("profiles")),
  }).index("by_clientKey", ["clientKey"]),

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
    status: v.union(
      v.literal("gathering"),
      v.literal("active"),
      v.literal("paused"),
    ),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_status", ["status"]),

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
  })
    .index("by_query", ["queryId"])
    .index("by_session", ["sessionId"])
    .index("by_query_fingerprint", ["queryId", "fingerprint"]),

  alertPrefs: defineTable({
    sessionId: v.id("sessions"),
    enabled: v.boolean(),
    email: v.optional(v.string()),
    lastEmailedAt: v.optional(v.number()),
    agentInboxId: v.optional(v.string()),
  }).index("by_session", ["sessionId"]),

  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
