/**
 * Cloudflare Pages Function
 * POST /api/auth/logout
 *
 * Clears the session cookie. POST-only (not GET) so a third-party page
 * can't force it just by loading an <img>/<a> pointed at this URL --
 * SameSite=Lax stops the *original* session cookie from being sent on a
 * cross-site subresource request, but it does NOT stop the browser from
 * honoring a Set-Cookie in the *response*, so a plain unauthenticated GET
 * endpoint here could still be used to force-logout someone from another
 * site. Requiring POST (only reachable from same-site JS, see
 * assets/command-access.js's logout button) closes that off. Returns
 * JSON rather than a redirect since it's now called via fetch(), not a
 * top-level navigation.
 */
export async function onRequestPost(context) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    "bcso_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// GET intentionally does NOT clear the cookie -- see the POST handler's
// comment above for why. This just tells anyone/anything hitting it via
// GET how to actually log out.
export async function onRequestGet() {
  return new Response(JSON.stringify({ error: "Use POST to log out." }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
