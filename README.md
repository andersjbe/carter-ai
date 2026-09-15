# Carter

Curious shopping agent built with Vite + React + Convex.

## Auth setup

Carter uses **Better Auth** via `@convex-dev/better-auth` (email/password + Google OAuth).

### Environment

Copy [`.env.example`](.env.example) to `.env.local` and fill Vite URLs from `npx convex dev`.

Set Convex deployment secrets:

```bash
npx convex env set SITE_URL http://localhost:5173
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set GOOGLE_CLIENT_ID "your-client-id.apps.googleusercontent.com"
npx convex env set GOOGLE_CLIENT_SECRET "your-client-secret"
```

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are optional on the deployment until you enable Google sign-in. Without them, email/password still works; the Google button will fail until both are set.

For production, set `SITE_URL` to the real SPA origin (never `*`). Keep `trustedOrigins` limited to that origin.

### Google OAuth (required for “Continue with Google”)

1. Create an OAuth 2.0 **Web** client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. **Authorized JavaScript origins:** your SPA origin(s), e.g. `http://localhost:5173` and the production site.
3. **Authorized redirect URI** must be the **Convex site** callback (not the Vite origin):

   ```
   https://<your-deployment>.convex.site/api/auth/callback/google
   ```

   Example (dev): `https://academic-deer-784.convex.site/api/auth/callback/google`

4. Put the client ID/secret into Convex env as above, then restart `npx convex dev`.

Password accounts require email verification (AgentMail). Google accounts are treated as verified and can link to an existing password user with the same email.

### Local apps

```bash
npm run dev:backend   # npx convex dev
npm run dev:frontend  # vite on :5173
```

## React + TypeScript + Vite

This project started from the Vite React TypeScript template. See Vite docs for HMR and Oxlint configuration.
