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

/**
 * Lists every member of the guild who holds a specific role, using the
 * BOT token. Paginates through the members list (Discord returns at most
 * 1000 per page) -- most servers only need one page, but this keeps
 * working correctly for larger ones too. Returns an empty array (never
 * throws) if the bot cannot reach Discord or the Server Members Intent
 * is not enabled, so a lookup failure just means no DMs go out that
 * time, not a broken application/log submission.
 */
export async function getGuildMembersWithRole(env, roleId) {
  const matched = [];
  let after = "0";
  for (let page = 0; page < 10; page++) {
    let res;
    try {
      res = await fetch(
        `https://discord.com/api/guilds/${GUILD_ID}/members?limit=1000&after=${after}`,
        { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
      );
    } catch {
      break;
    }
    if (!res.ok) break;
    const members = await res.json().catch(() => []);
    if (!Array.isArray(members) || !members.length) break;
    for (const m of members) {
      if (m.user && Array.isArray(m.roles) && m.roles.includes(roleId)) {
        matched.push(m.user.id);
      }
    }
    if (members.length < 1000) break;
    after = members[members.length - 1].user.id;
  }
  return matched;
}

/**
 * Sends a Discord DM to a single user via the bot (opens/reuses a DM
 * channel, then posts the message). Best-effort and non-fatal -- a
 * failure here (DMs closed, bot not sharing a server with them, rate
 * limit, etc.) is logged and swallowed so it never blocks or breaks the
 * application/log submission that triggered it.
 */
export async function sendDirectMessage(env, userId, content) {
  try {
    const channelRes = await fetch("https://discord.com/api/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!channelRes.ok) {
      console.error("Couldn't open DM channel with", userId, channelRes.status);
      return;
    }
    const channel = await channelRes.json();
    const msgRes = await fetch(`https://discord.com/api/channels/${channel.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    if (!msgRes.ok) {
      console.error("Couldn't DM", userId, msgRes.status);
    }
  } catch (err) {
    console.error("Failed to send Discord DM to", userId, err);
  }
}
