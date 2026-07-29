/**
 * Cloudflare Pages Function
 * GET /api/auth/logout
 *
 * Clears the session cookie and sends the person back to the homepage.
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const headers = new Headers();
  headers.set("Location", `${url.origin}/index.html`);
  headers.append(
    "Set-Cookie",
    "bcso_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
  return new Response(null, { status: 302, headers });
}
