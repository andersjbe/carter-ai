# Hackathon log

- **Project:** Carter
- **Event:** Convex All Gas Hackathon
- **What it does:** Curious ChatGPT shopping agent that learns preferences, searches Amazon/Etsy/web via Firecrawl, and emails new-find digests through AgentMail.
- **Live app:** not deployed
- **Repo:** https://github.com/andersjbe/carter-ai
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/agent, @convex-dev/better-auth, @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/static-hosting
- **Convex features:** queries, mutations, actions, HTTP actions, crons, agent threads/streaming, auth
- **Auth:** Other
- **AI models:** openai/gpt-4o-mini (Convex AI Gateway)
- **Started:** 2026-09-06T19:24:04Z
- **Last updated:** 2026-09-12T13:24:53Z

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
