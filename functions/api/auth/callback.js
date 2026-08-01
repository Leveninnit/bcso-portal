/**
 * Cloudflare Pages Function
 * GET /api/auth/callback
 *
 * Discord redirects here after someone approves the "Login with
 * Discord" prompt. Exchanges the one-time code for that person's
 * identity, looks up their actual server roles using the bot token
 * (not anything Discord handed back in the OAuth step, which keeps
 * this accurate even if their roles changed since they last logged
 * in), and — only if they hold the Command Login role — issues a
 * signed session cookie and sends them to the dashboard.
 */
import {
  exchangeCode,
  getOAuthUser,
  getGuildMemberRoles,
  computePermissions,
} from "../../_lib/discord.js";
import { signSession } from "../../_lib/session.js";

const SESSION_HOURS = 12;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return Response.redirect(
      `${url.origin}/command-access.html?error=${encodeURIComponent(oauthError)}`,
      302
    );
  }
  if (!code) {
    return Response.redirect(`${url.origin}/command-access.html?error=missing_code`, 302);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_BOT_TOKEN || !env.SESSION_SECRET) {
    return new Response(
      "Command Access login isn't fully configured yet — missing one of DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_BOT_TOKEN / SESSION_SECRET.",
      { status: 500 }
    );
  }

  try {
    const redirectUri = `${url.origin}/api/auth/callback`;
    const tokenData = await exchangeCode(env, code, redirectUri);
    const discordUser = await getOAuthUser(tokenData.access_token);
    const roles = await getGuildMemberRoles(env, discordUser.id);
  const isHighCommand = roles.includes("1533008196023746591");
    const permissions = computePermissions(roles);

    if (!permissions.hasCommandLogin) {
      return Response.redirect(`${url.origin}/command-access.html?error=no_access`, 302);
    }

    const session = await signSession(env.SESSION_SECRET, {
      discordId: discordUser.id,
      username: discordUser.username,
      subdivisions: permissions.subdivisions,
      exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
    
    isHighCommand,});

    const headers = new Headers();
    const state = url.searchParams.get("state") || "";
  const redirectBase = `${url.origin}/command-access.html`;
  const redirectTarget = /^div=[a-z0-9_-]{1,30}(&type=(application|log))?(&id=\d{1,10})?$/.test(state)
    ? `${redirectBase}?${state}`
    : redirectBase;
  headers.set("Location", redirectTarget);
    headers.append(
      "Set-Cookie",
      `bcso_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
    );
    return new Response(null, { status: 302, headers });
  } catch (e) {
    console.error("Command Access login failed:", e);
    return Response.redirect(`${url.origin}/command-access.html?error=login_failed`, 302);
  }
}
