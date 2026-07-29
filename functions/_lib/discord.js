/**
 * Shared Discord server/role configuration and API helpers for the
 * Command Access system.
 *
 * None of the IDs below are secret — anyone in the Discord server with
 * Developer Mode enabled can see role/server/user IDs by right-clicking
 * them, so it's safe to keep these in the repo. The bot token, OAuth
 * client secret, and session-signing secret ARE secret and only ever
 * come from Cloudflare environment variables — never hardcoded here.
 *
 * Files under functions/_lib/ are NOT routed by Cloudflare Pages
 * (folders starting with "_" are treated as shared code, not endpoints)
 * — this file is imported by the actual route handlers.
 */

export const GUILD_ID = "1531851660798857216";

// Holding this role lets someone log into Command Access at all.
export const COMMAND_LOGIN_ROLE_ID = "1531995929585123459";

// Maps a subdivision slug to the Discord role ID that grants "command"
// rights for that subdivision specifically (customize its questions,
// view/accept/reject/delete its applications and logs). Add a line here
// when a new subdivision gets its own command role.
export const SUBDIVISION_COMMAND_ROLES = {
  teu: "1531996065530904788",
  ocd: "1531995971096150016",
  srt: "1531995966448734381",
  rtd: "1531995963164721264",
  nred: "1531995968738820276",
};

/**
 * Given the array of Discord role IDs a person holds, work out what
 * they're allowed to do on the Command Access dashboard.
 */
export function computePermissions(roleIds) {
  const roleSet = new Set(roleIds || []);
  const hasCommandLogin = roleSet.has(COMMAND_LOGIN_ROLE_ID);
  const subdivisions = Object.keys(SUBDIVISION_COMMAND_ROLES).filter((slug) =>
    roleSet.has(SUBDIVISION_COMMAND_ROLES[slug])
  );
  return { hasCommandLogin, subdivisions };
}

/** Exchanges an OAuth2 authorization code for an access token. */
export async function exchangeCode(env, code, redirectUri) {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error("Discord token exchange failed: " + res.status);
  return res.json();
}

/** Gets the Discord identity (id/username/avatar) for an OAuth access token. */
export async function getOAuthUser(accessToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Discord identity: " + res.status);
  return res.json();
}

/**
 * Gets a guild member's roles using the BOT token (not the user's OAuth
 * token) — the bot must be in the server with the Server Members Intent
 * enabled. Returns an empty array (rather than throwing) if the person
 * isn't found, so a login attempt from someone not in the server just
 * fails softly into "no permissions" instead of a server error.
 */
export async function getGuildMemberRoles(env, discordUserId) {
  const res = await fetch(
    `https://discord.com/api/guilds/${GUILD_ID}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
  );
  if (!res.ok) return [];
  const member = await res.json();
  return member.roles || [];
}
