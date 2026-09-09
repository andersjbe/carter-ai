import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import { registerStaticRoutes } from "@convex-dev/static-hosting";

const http = httpRouter();
const agentmail = new AgentMail(components.agentmail);

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) =>
    // AgentMail types expect a mutation ctx; httpAction is compatible at runtime.
    agentmail.handleWebhook(ctx as any, req),
  ),
});

registerStaticRoutes(http, components.staticHosting);

export default http;
