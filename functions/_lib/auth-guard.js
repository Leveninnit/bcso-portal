import { verifySession, parseCookies } from "./session.js";

/**
 * Verifies the request's session cookie and, if a subdivision slug is
 * given, confirms the session holds that subdivision's command role.
 * Returns the decoded session payload on success, or null if the caller
 * is not logged in / doesn't have the required subdivision permission.
 */
export async function requireSession(request, env, subdivisionSlug) {
  if (!env.SESSION_SECRET) return null;
  const cookies = parseCookies(request);
  const payload = await verifySession(env.SESSION_SECRET, cookies.bcso_session);
  if (!payload) return null;
  if (subdivisionSlug && !(payload.subdivisions || []).includes(subdivisionSlug)) {
    return null;
  }
  return payload;
}
