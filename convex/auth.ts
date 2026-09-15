import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import {
  requireActionCtx,
  requireRunMutationCtx,
} from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth/minimal";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env, query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = env.SITE_URL;

export const authComponent = createClient<DataModel>(components.betterAuth);

async function sendAuthEmail(
  ctx: GenericCtx<DataModel>,
  args: { to: string; subject: string; text: string },
) {
  // Password-reset / verification only run on HTTP action handlers.
  await requireActionCtx(ctx).runAction(internal.mail.sendAuthEmail, args);
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const googleConfigured =
    Boolean(googleClientId?.trim()) && Boolean(googleClientSecret?.trim());

  return betterAuth({
    baseURL: env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(ctx, {
          to: user.email,
          subject: "Reset your Carter password",
          text: `Reset your password with this link:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(ctx, {
          to: user.email,
          subject: "Verify your Carter email",
          text: `Verify your email with this link:\n\n${url}\n\nIf you did not create a Carter account, you can ignore this email.`,
        });
      },
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
          },
        }
      : undefined,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await requireRunMutationCtx(ctx).runMutation(
            internal.accounts.purgeUserData,
            { userId: user.id },
          );
        },
      },
    },
    plugins: [
      crossDomain({ siteUrl }),
      convex({ authConfig }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
      image: v.optional(v.union(v.string(), v.null())),
      emailVerified: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return {
      id: user._id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },
});
