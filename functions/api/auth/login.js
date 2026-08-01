/**
 * Cloudflare Pages Function
 * GET /api/auth/login
 *
 * Redirects to Discord's OAuth2 authorize page. Discord sends the
 * person back to /api/auth/callback with a one-time code once they
 * approve. Only asks for the "identify" scope — we don't need Discord
 * to hand us their server roles directly; the callback looks those up
 * itself using the bot token, which is more reliable.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DISCORD_CLIENT_ID) {
    return new Response(
      "Command Access login isn't configured yet (missing DISCORD_CLIENT_ID environment variable).",
      { status: 500 }
    );
  }
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "identify");

  // Optional deep link (e.g. from a DM notification pointing at one
  // application/log) -- round-tripped through OAuth's "state" param so
  // command-access.js can jump straight there once login finishes.
  // Tightly whitelisted so this can never become an open redirect.
  const returnTo = url.searchParams.get("returnTo") || "";
  if (/^div=[a-z0-9_-]{1,30}(&type=(application|log))?(&id=\d{1,10})?$/.test(returnTo)) {
    authorizeUrl.searchParams.set("state", returnTo);
  }
  return Response.redirect(authorizeUrl.toString(), 302);
}
