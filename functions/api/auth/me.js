/**
 * Cloudflare Pages Function
 * GET /api/auth/me
 *
 * Tells the Command Access dashboard's JavaScript whether the visitor
 * is logged in and which subdivisions they have command rights for, so
 * it knows what to show. Never errors on a missing/invalid session —
 * it just reports loggedIn: false.
 */
import { verifySession, parseCookies } from "../../_lib/session.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SESSION_SECRET) return jsonResponse({ loggedIn: false }, 200);
  const cookies = parseCookies(request);
  const payload = await verifySession(env.SESSION_SECRET, cookies.bcso_session);
  if (!payload) return jsonResponse({ loggedIn: false }, 200);
  return jsonResponse(
    {
      loggedIn: true,
      username: payload.username,
      subdivisions: payload.subdivisions || [],
    },
    200
  );
}
