# Hackathon log

- **Project:** Carter
- **Event:** Convex All Gas Hackathon
- **What it does:** Curious ChatGPT shopping agent that learns preferences, searches Amazon/Etsy and user-chosen specialty stores via Firecrawl (with Discover stores suggesting domains as chips), lets shoppers like or pass findings, save buy-intent products to shopping lists, and emails list price-drop digests through AgentMail.
- **Live app:** not deployed
- **Repo:** https://github.com/andersjbe/carter-ai
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/agent, @convex-dev/better-auth, @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/static-hosting
- **Convex features:** queries, mutations, actions, HTTP actions, crons, agent threads/streaming, auth
- **Auth:** Other
- **AI models:** openai/gpt-4o-mini (Convex AI Gateway)
- **Started:** 2026-09-06T19:24:04Z
- **Last updated:** 2026-09-16T12:55:19Z

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

### 2026-09-13 - c4a5179
Committed like/pass verdicts from the working tree (`convex/findings.ts`, `convex/schema.ts`, `convex/carterAgent.ts`, `src/pages/ChatApp.tsx`). Convex features: schema, indexes, mutations, queries.

### 2026-09-13 - 58f315e
Committed shopping lists, Lists page, and list-scoped digests/mail prefs (`convex/shoppingLists.ts`, `src/pages/ListsPage.tsx`, `convex/mail.ts`, `convex/digests.ts`, `convex/schema.ts`). Convex features: schema, indexes, mutations, queries, actions, crons.

### 2026-09-13 - working tree
Redesigned Chat and Lists around shared AppShell/topbar and ProductCard: image-led list items, click-to-edit titles, compact price alerts, warm dark theme instead of aubergine ambient, stacked Knows/Queries/Findings context, and open-query cards that jump to the matching user question in chat without snapping back to the bottom (`src/components/AppShell.tsx`, `src/components/ProductCard.tsx`, `src/pages/ChatApp.tsx`, `src/pages/ListsPage.tsx`, `src/index.css`).

### 2026-09-13 - 0b9a9d7
Committed the AppShell/ProductCard redesign, account menu, Lists title editing, and warmer theme tokens from the working tree (`src/components/AppShell.tsx`, `src/components/ProductCard.tsx`, `src/pages/ChatApp.tsx`, `src/pages/ListsPage.tsx`, `src/index.css`).

### 2026-09-13 - 8f22e5d
Polished responsive layout spacing and AppShell account label so chat and product cards hold up better on narrow screens (`src/components/AppShell.tsx`, `src/index.css`).

### 2026-09-15 - aac4dbf
Made the shopping context panel mobile-friendly with a sheet overlay, close control, and viewport-aware open/collapse behavior (`src/pages/ChatApp.tsx`, `src/index.css`).

### 2026-09-15 - 84c485a
Added conversation thread delete (cascade session data + agent thread cleanup, in-app confirm popover, seamless handoff to another chat) and inline rename (pencil/double-click, Enter/blur save) so custom titles survive the first message. Softened light-mode user bubbles to cream on ink (`convex/sessions.ts`, `convex/chat.ts`, `src/pages/ChatApp.tsx`, `src/index.css`). Convex features: mutations, agent thread delete/metadata.

### 2026-09-15 - working tree
Shipped per-query website search selection (Amazon/Etsy/open web toggles plus custom domains via Firecrawl `includeDomains`), user Profile defaults that seed new open queries, and multi-pass digest rechecks that honor the full scope. Fixed mobile topbar overlap so Account no longer collides with email/nav (`convex/lib/searchScope.ts`, `convex/userSearchPrefs.ts`, `convex/openQueries.ts`, `convex/carterAgent.ts`, `convex/digests.ts`, `convex/schema.ts`, `src/pages/ProfilePage.tsx`, `src/components/SearchScopeEditor.tsx`, `src/pages/ChatApp.tsx`, `src/components/AppShell.tsx`). Convex features: schema, indexes, mutations, queries, actions, agent tools.

### 2026-09-15 - 09ba5e0
Committed the search-scope / Profile defaults work from the working tree (`convex/userSearchPrefs.ts`, `convex/lib/searchScope.ts`, `src/pages/ProfilePage.tsx`, `src/components/SearchScopeEditor.tsx`). Convex features: schema, indexes, mutations, queries.

### 2026-09-15 - working tree
Hardened Better Auth for production: Google OAuth on login (optional `GOOGLE_CLIENT_*` env), required email verification and password reset/forgot flows via AgentMail auth mail, and Profile account deletion that purges chats, lists, prefs, and agent threads before removing the Better Auth user (`convex/auth.ts`, `convex/accounts.ts`, `convex/mail.ts`, `src/pages/LoginPage.tsx`, `src/pages/ForgotPasswordPage.tsx`, `src/pages/ResetPasswordPage.tsx`, `src/pages/ProfilePage.tsx`, `.env.example`, `README.md`). Convex features: auth, mutations, actions, HTTP actions.

### 2026-09-15 - 0fae199
Committed the Better Auth production hardening from the working tree: Google OAuth, email verification, password reset/forgot, and account deletion with data purge (`convex/auth.ts`, `convex/accounts.ts`, `convex/mail.ts`, `src/pages/LoginPage.tsx`, `src/pages/ForgotPasswordPage.tsx`, `src/pages/ResetPasswordPage.tsx`, `src/pages/ProfilePage.tsx`). Convex features: auth, mutations, actions, HTTP actions.

### 2026-09-15 - working tree
Telegraphed like/pass learning under chat product grids, refreshed landing copy for per-site search, and fixed AgentMail auth/digest delivery by calling AgentMail’s HTTP API from parent actions (component create/send cannot see `AGENTMAIL_API_KEY`), plus a resend-verification control on login (`src/pages/ChatApp.tsx`, `src/index.css`, `src/pages/LandingPage.tsx`, `convex/mail.ts`, `convex/digests.ts`, `convex/auth.ts`, `convex/convex.config.ts`, `src/pages/LoginPage.tsx`). Convex features: actions, auth, typed env.

### 2026-09-15 - working tree
Replaced open-web product search with marketplace discovery: `"web"` now means Discover stores, `resolveSearchScope` only searches Amazon/Etsy/custom domains, Firecrawl `discoverMarketplaces` suggests specialty hosts, and chat store chips add confirmed domains before product search (`convex/lib/searchScope.ts`, `convex/firecrawl.ts`, `convex/carterAgent.ts`, `convex/digests.ts`, `src/pages/ChatApp.tsx`, `src/components/SearchScopeEditor.tsx`, `src/pages/LandingPage.tsx`). Convex features: actions, agent tools, mutations.

### 2026-09-16 - working tree
Split product search into one Firecrawl pass per domain with `site:` bias so specialty stores (e.g. kingsize.com) keep SERP slots next to Amazon/Etsy; default limit scales with domain count (`convex/lib/searchScope.ts`, `convex/carterAgent.ts`, digests inherit via `resolveSearchScope`). Convex features: actions, agent tools, crons.

### 2026-09-15 - f6207d9
Committed AgentMail HTTP send for auth and digest mail, login resend-verification, and product-learning copy/UI from the working tree (`convex/mail.ts`, `convex/digests.ts`, `convex/auth.ts`, `src/pages/LoginPage.tsx`, `src/pages/ChatApp.tsx`). Convex features: actions, auth.

### 2026-09-15 - a86ede9
Added fade-in and press animations across chat, product cards, theme toggle, and Lists loading so UI transitions feel less abrupt (`src/index.css`, `src/pages/ChatApp.tsx`, `src/components/ProductCard.tsx`, `src/components/ThemeToggle.tsx`).

### 2026-09-16 - 88fb1e0
Committed Discover-stores marketplace search, chat store chips, MessageMarkdown, and per-domain Firecrawl `site:` passes from the working tree (`convex/firecrawl.ts`, `convex/lib/searchScope.ts`, `convex/carterAgent.ts`, `convex/openQueries.ts`, `src/pages/ChatApp.tsx`). Convex features: actions, agent tools, mutations, schema.

### 2026-09-16 - working tree
Hardened ownership and cron fairness: agent tools verify open-query session ownership, alerts/profile email lock to the verified account address, shopping lists use denormalized `itemCount` with bounded reads, and open-query/digest crons rotate via `lastCheckedAt` / `lastEmailedAt` indexes; AgentMail shared inbox create is first-writer-wins (`convex/lib/sessionAuth.ts`, `convex/carterAgent.ts`, `convex/mail.ts`, `convex/profiles.ts`, `convex/shoppingLists.ts`, `convex/openQueries.ts`, `convex/schema.ts`, `src/pages/ListsPage.tsx`). Convex features: schema, indexes, mutations, queries, actions, auth.

### 2026-09-16 - 62437c4
Committed the ownership, batch list deletion, session cleanup, and fair-cron indexing work from the working tree (`convex/shoppingLists.ts`, `convex/accounts.ts`, `convex/schema.ts`, `convex/mail.ts`, `convex/lib/sessionAuth.ts`). Convex features: schema, indexes, mutations, queries, actions, auth.

### 2026-09-16 - working tree
Simplified the shopping context panel: Findings cards stack image over text for the narrow column, and What Carter knows shows only the prose summary (no preference chips or show-details toggle). Tightened `updatePreferences` so reply-chip answers land in structured fields with merge-safe upserts (`src/pages/ChatApp.tsx`, `src/index.css`, `convex/carterAgent.ts`, `convex/profiles.ts`). Convex features: mutations, agent tools, realtime queries.
