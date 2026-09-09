/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as carterAgent from "../carterAgent.js";
import type * as chat from "../chat.js";
import type * as chatActions from "../chatActions.js";
import type * as crons from "../crons.js";
import type * as digests from "../digests.js";
import type * as findings from "../findings.js";
import type * as firecrawl from "../firecrawl.js";
import type * as http from "../http.js";
import type * as mail from "../mail.js";
import type * as openQueries from "../openQueries.js";
import type * as profiles from "../profiles.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  carterAgent: typeof carterAgent;
  chat: typeof chat;
  chatActions: typeof chatActions;
  crons: typeof crons;
  digests: typeof digests;
  findings: typeof findings;
  firecrawl: typeof firecrawl;
  http: typeof http;
  mail: typeof mail;
  openQueries: typeof openQueries;
  profiles: typeof profiles;
  sessions: typeof sessions;
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
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
