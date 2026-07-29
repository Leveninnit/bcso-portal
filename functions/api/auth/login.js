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
  return Response.redirect(authorizeUrl.toString(), 302);
}
