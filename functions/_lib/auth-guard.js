import { verifySession, parseCookies } from "./session.js";
import { getGuildMemberRoles, computePermissions } from "./discord.js";

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

/**
 * Same as requireSession, but for the highest-stakes actions (deleting a
 * submission, deciding one) -- re-checks the person's *live* Discord
 * roles instead of trusting whatever role list got baked into the
 * session cookie at login time. Sessions are stateless and can't be
 * revoked (see session.js), so without this, someone stripped of a
 * command role -- or removed from the server entirely -- mid-session
 * would keep destructive access to that subdivision's data until their
 * cookie naturally expires. Fails closed: if the live lookup can't
 * confirm the permission (including a transient Discord API hiccup),
 * this denies rather than falling back to the stale cached session --
 * the whole point is to not trust stale data for destructive actions.
 */
export async function requireFreshSession(request, env, subdivisionSlug) {
  const session = await requireSession(request, env, subdivisionSlug);
  if (!session || !session.discordId) return session;
  const liveRoles = await getGuildMemberRoles(env, session.discordId);
  const perms = computePermissions(liveRoles);
  if (!perms.hasCommandLogin) return null;
  if (subdivisionSlug && !perms.subdivisions.includes(subdivisionSlug)) return null;
  return { ...session, subdivisions: perms.subdivisions, isHighCommand: session.isHighCommand };
}
