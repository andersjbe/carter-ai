# Hackathon log

- **Project:** Carter
- **Event:** Convex All Gas Hackathon
- **What it does:** Curious ChatGPT shopping agent that learns preferences, searches Amazon/Etsy/web via Firecrawl, lets shoppers like or pass findings, save buy-intent products to shopping lists, and emails list price-drop digests through AgentMail.
- **Live app:** not deployed
- **Repo:** https://github.com/andersjbe/carter-ai
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/agent, @convex-dev/better-auth, @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/static-hosting
- **Convex features:** queries, mutations, actions, HTTP actions, crons, agent threads/streaming, auth
- **Auth:** Other
- **AI models:** openai/gpt-4o-mini (Convex AI Gateway)
- **Started:** 2026-09-06T19:24:04Z
- **Last updated:** 2026-09-13T14:30:00Z

## Log

### 2026-09-06 - e7acfb7
Installed the Convex All Gas Hackathon build-log skill and created the initial log. Confirmed frontend hosting as Convex static hosting (`convex.site`).

### 2026-09-09 - working tree
Scaffolded Vite + React + Convex and built Carter end to end: curious `@convex-dev/agent` chat with preference tools, open queries, Firecrawl search/scrape findings, AgentMail alert digests on a 3-hour cron, and static hosting wired for later `convex.site` publish (`convex/carterAgent.ts`, `convex/firecrawl.ts`, `convex/mail.ts`, `convex/crons.ts`, `src/App.tsx`). Local Convex push succeeded; frontend boots on Vite. Real Firecrawl/AgentMail keys and cloud publish still pending.

### 2026-09-09 - d5dfbe9
Committed the Carter agent stack from the working tree onto `cursor/all-gas-hackathon-setup` and published the public GitHub remote.

### 2026-09-09 - 1ba9f20
Rendered Firecrawl findings as product cards with optional images in chat and the findings panel (`convex/firecrawl.ts`, `convex/carterAgent.ts`, `src/App.tsx`).

### 2026-09-12 - 13ac833
Added Better Auth (`@convex-dev/better-auth`) with landing and login pages, then moved sessions from anonymous `clientKey` to authenticated `userId` ownership with checks on public chat/profile/mail APIs (`convex/auth.ts`, `convex/sessions.ts`, `convex/lib/sessionAuth.ts`, `src/pages/*`).

### 2026-09-12 - ba01935
Tightened Firecrawl result filtering so search hits prefer product detail pages over category or listing URLs (`convex/firecrawl.ts`).

### 2026-09-12 - c272502
Shipped multi-conversation shopping sessions (one empty chat per user, titles from the first message, full session reset for prefs/queries/findings), a viewport-locked chat UI with a tabbed context column, and a persisted aubergine dark mode (`convex/sessions.ts`, `convex/chat.ts`, `convex/schema.ts`, `src/pages/ChatApp.tsx`, `src/lib/theme.ts`). Convex features: mutations, queries, indexes, agent threads.

### 2026-09-13 - 50a1cf0
Cut Firecrawl credit burn: search is metadata-only (no scrape-on-search), known product URLs are skipped, detail enrich is capped and prefers free open-web fetch before lean Firecrawl scrapes, and digests recheck on a 6-hour cron with one hint/source and no enrich (`convex/firecrawl.ts`, `convex/digests.ts`, `convex/crons.ts`, `convex/findings.ts`). Convex features: actions, queries, crons.

### 2026-09-13 - 5233649
Added tappable reply chips for Carter's single clarifying turn via an `offerReplyChoices` agent tool, chat-action parsing, and ChatApp chip UI so users can multi-select answers without typing everything (`convex/carterAgent.ts`, `convex/chatActions.ts`, `src/pages/ChatApp.tsx`). Convex features: agent tools, actions.

### 2026-09-13 - working tree
Shipped like/pass verdicts on product findings: soft-keep likes stay highlighted, rejects hide from Findings and chat cards, session-rejected URLs are skipped on later Firecrawl searches, and `listFindings` plus agent instructions feed accepted/rejected picks into future turns (`convex/schema.ts`, `convex/findings.ts`, `convex/firecrawl.ts`, `convex/carterAgent.ts`, `src/pages/ChatApp.tsx`). Convex features: schema, indexes, mutations, queries, agent tools.

### 2026-09-13 - working tree
Added user-scoped shopping lists (create/rename/delete, add from product cards, Lists tab) distinct from likes, moved AgentMail prefs onto lists, and switched digests to price-drop scrapes of listed items while open-query rechecks stay UI-only (`convex/schema.ts`, `convex/shoppingLists.ts`, `convex/mail.ts`, `convex/digests.ts`, `convex/firecrawl.ts`, `convex/crons.ts`, `src/pages/ChatApp.tsx`). Convex features: schema, indexes, mutations, queries, actions, crons.
