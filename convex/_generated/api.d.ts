/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as carterAgent from "../carterAgent.js";
import type * as chat from "../chat.js";
import type * as chatActions from "../chatActions.js";
import type * as crons from "../crons.js";
import type * as digests from "../digests.js";
import type * as findings from "../findings.js";
import type * as firecrawl from "../firecrawl.js";
import type * as http from "../http.js";
import type * as lib_searchScope from "../lib/searchScope.js";
import type * as lib_sessionAuth from "../lib/sessionAuth.js";
import type * as lib_sessionTitle from "../lib/sessionTitle.js";
import type * as mail from "../mail.js";
import type * as openQueries from "../openQueries.js";
import type * as profiles from "../profiles.js";
import type * as sessions from "../sessions.js";
import type * as shoppingLists from "../shoppingLists.js";
import type * as userSearchPrefs from "../userSearchPrefs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  auth: typeof auth;
  carterAgent: typeof carterAgent;
  chat: typeof chat;
  chatActions: typeof chatActions;
  crons: typeof crons;
  digests: typeof digests;
  findings: typeof findings;
  firecrawl: typeof firecrawl;
  http: typeof http;
  "lib/searchScope": typeof lib_searchScope;
  "lib/sessionAuth": typeof lib_sessionAuth;
  "lib/sessionTitle": typeof lib_sessionTitle;
  mail: typeof mail;
  openQueries: typeof openQueries;
  profiles: typeof profiles;
  sessions: typeof sessions;
  shoppingLists: typeof shoppingLists;
  userSearchPrefs: typeof userSearchPrefs;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
