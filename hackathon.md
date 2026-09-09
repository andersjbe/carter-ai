# Hackathon log

- **Project:** Carter
- **Event:** Convex All Gas Hackathon
- **What it does:** Curious ChatGPT shopping agent that learns preferences, searches Amazon/Etsy/web via Firecrawl, and emails new-find digests through AgentMail.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/agent, @firecrawl/firecrawl-convex, @agentmail/convex, @convex-dev/static-hosting
- **Convex features:** queries, mutations, actions, HTTP actions, crons, agent threads/streaming
- **Auth:** none
- **AI models:** openai/gpt-4o-mini (Convex AI Gateway)
- **Started:** 2026-09-06T19:24:04Z
- **Last updated:** 2026-09-09T11:37:00Z

## Log

### 2026-09-06 - e7acfb7
Installed the Convex All Gas Hackathon build-log skill and created the initial log. Confirmed frontend hosting as Convex static hosting (`convex.site`).

### 2026-09-09 - working tree
Scaffolded Vite + React + Convex and built Carter end to end: curious `@convex-dev/agent` chat with preference tools, open queries, Firecrawl search/scrape findings, AgentMail alert digests on a 3-hour cron, and static hosting wired for later `convex.site` publish (`convex/carterAgent.ts`, `convex/firecrawl.ts`, `convex/mail.ts`, `convex/crons.ts`, `src/App.tsx`). Local Convex push succeeded; frontend boots on Vite. Real Firecrawl/AgentMail keys and cloud publish still pending.
