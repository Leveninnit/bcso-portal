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
  const validReturnTo = /^div=[a-z0-9_-]{1,30}(&type=(application|log))?(&id=\d{1,10})?$/.test(returnTo)
    ? returnTo
    : "";

  // CSRF protection: a random nonce goes into both a short-lived HttpOnly
  // cookie and the OAuth "state" param. The callback only issues a
  // session if the state it gets back still carries this same nonce.
  // Without this, an attacker could start their own OAuth flow, capture
  // the resulting callback link (which contains *their* one-time code),
  // and get someone else to open it -- silently logging that person's
  // browser in as the attacker's Discord identity ("login CSRF").
  const nonce = crypto.randomUUID().replace(/-/g, "");
  authorizeUrl.searchParams.set("state", validReturnTo ? `${nonce}|${validReturnTo}` : nonce);

  const headers = new Headers();
  headers.set("Location", authorizeUrl.toString());
  headers.append(
    "Set-Cookie",
    `bcso_oauth_state=${nonce}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );
  return new Response(null, { status: 302, headers });
}
