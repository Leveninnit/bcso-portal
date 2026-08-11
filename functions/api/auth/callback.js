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
  HIGH_COMMAND_ROLE_ID,
} from "../../_lib/discord.js";
import { signSession, parseCookies } from "../../_lib/session.js";

// Shortened from 12h -- sessions are stateless and can't be revoked (see
// session.js), so this is the main lever for how long someone keeps
// dashboard access after being stripped of their Discord role. Destructive
// actions (deleting/deciding a submission) additionally re-check live
// Discord roles via requireFreshSession regardless of this TTL.
const SESSION_HOURS = 6;

// Constant-time string comparison for the OAuth CSRF nonce -- a plain
// `!==` short-circuits on the first differing character, which leaks a
// tiny per-character timing signal. The nonce only ever travels over TLS
// and a full timing-based recovery is impractical regardless, but this
// costs nothing and matches the timing-safe comparison session.js already
// uses for the session cookie's signature.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Clears the short-lived OAuth CSRF-nonce cookie set by /api/auth/login,
// regardless of which path this response takes (success or any error).
function expireStateCookie(headers) {
  headers.append("Set-Cookie", "bcso_oauth_state=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    const headers = new Headers();
    headers.set("Location", `${url.origin}/command-access.html?error=${encodeURIComponent(oauthError)}`);
    expireStateCookie(headers);
    return new Response(null, { status: 302, headers });
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

  // CSRF check: the nonce this browser was given by /api/auth/login must
  // match the nonce embedded in the "state" Discord handed back. If it
  // doesn't (missing cookie, mismatched nonce, or state tampered with),
  // refuse to log this browser in -- see the comment in login.js for why.
  const stateParam = url.searchParams.get("state") || "";
  const sepIndex = stateParam.indexOf("|");
  const stateNonce = sepIndex === -1 ? stateParam : stateParam.slice(0, sepIndex);
  const returnTo = sepIndex === -1 ? "" : stateParam.slice(sepIndex + 1);
  const expectedNonce = parseCookies(request)["bcso_oauth_state"];
  if (!expectedNonce || !stateNonce || !timingSafeEqual(stateNonce, expectedNonce)) {
    const headers = new Headers();
    headers.set("Location", `${url.origin}/command-access.html?error=invalid_state`);
    expireStateCookie(headers);
    return new Response(null, { status: 302, headers });
  }

  try {
    const redirectUri = `${url.origin}/api/auth/callback`;
    const tokenData = await exchangeCode(env, code, redirectUri);
    const discordUser = await getOAuthUser(tokenData.access_token);
    const roles = await getGuildMemberRoles(env, discordUser.id);
    const isHighCommand = roles.includes(HIGH_COMMAND_ROLE_ID);
    const permissions = computePermissions(roles);

    if (!permissions.hasCommandLogin) {
      const headers = new Headers();
      headers.set("Location", `${url.origin}/command-access.html?error=no_access`);
      expireStateCookie(headers);
      return new Response(null, { status: 302, headers });
    }

    const session = await signSession(env.SESSION_SECRET, {
      discordId: discordUser.id,
      username: discordUser.username,
      subdivisions: permissions.subdivisions,
      isHighCommand,
      exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
    });

    const redirectBase = `${url.origin}/command-access.html`;
    const redirectTarget = /^div=[a-z0-9_-]{1,30}(&type=(application|log))?(&id=\d{1,10})?$/.test(returnTo)
      ? `${redirectBase}?${returnTo}`
      : redirectBase;

    const headers = new Headers();
    headers.set("Location", redirectTarget);
    headers.append(
      "Set-Cookie",
      `bcso_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
    );
    expireStateCookie(headers);
    return new Response(null, { status: 302, headers });
  } catch (e) {
    console.error("Command Access login failed:", e);
    const headers = new Headers();
    headers.set("Location", `${url.origin}/command-access.html?error=login_failed`);
    expireStateCookie(headers);
    return new Response(null, { status: 302, headers });
  }
}
