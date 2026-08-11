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

// High Command spans every subdivision rather than granting one specific
// subdivision's command rights, so it isn't part of
// SUBDIVISION_COMMAND_ROLES below -- it's checked separately (see
// functions/api/auth/callback.js, the only place that reads this) and
// gets baked into the session as the isHighCommand flag, which is what
// functions/api/admin/team.js and site-content.js actually check.
// Centralized here (rather than inline in callback.js) so there's exactly
// one place to update if this role ID ever changes.
export const HIGH_COMMAND_ROLE_ID = "1533008196023746591";

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
 * channel, then posts the message). Non-fatal -- never throws -- but,
 * unlike the fire-and-forget notifications this was originally written
 * for, it DOES report back whether the DM actually went out, via the
 * same { ok, error } shape postBotMessage uses below. The original
 * best-effort callers (application/log command-staff notifications) can
 * keep ignoring the return value exactly as before; a caller like the
 * Command Access emergency alert, where silently failing to deliver
 * would defeat the entire point of the feature, can check `ok` and tell
 * the person who sent it that it didn't go through.
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
      return { ok: false, error: `Couldn't open a DM channel (status ${channelRes.status}).` };
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
      return { ok: false, error: `Discord rejected the DM (status ${msgRes.status}).` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Failed to send Discord DM to", userId, err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Resolves which Discord webhook URL to use for a given form type +
 * subdivision, matching the per-subdivision override convention already
 * used by apply.js and log.js:
 *   applications  -> DISCORD_WEBHOOK_<SLUG>, falls back to DISCORD_WEBHOOK_URL
 *   activity logs -> DISCORD_WEBHOOK_<SLUG>_LOG, falls back to DISCORD_WEBHOOK_LOG
 * Centralized here so admin/submissions.js can re-derive the exact same
 * webhook a submission was originally posted to, without storing the
 * webhook's secret token anywhere in the database.
 */
export function resolveWebhookUrl(env, formType, subdivisionSlug) {
  const slug = (subdivisionSlug || "").toUpperCase();
  if (formType === "log") {
    return env[`DISCORD_WEBHOOK_${slug}_LOG`] || env.DISCORD_WEBHOOK_LOG || null;
  }
  return env[`DISCORD_WEBHOOK_${slug}`] || env.DISCORD_WEBHOOK_URL || null;
}

/**
 * Looks up which channel a configured webhook URL points at, by asking
 * Discord for the webhook's own metadata (a plain GET, no auth needed --
 * the id+token in the URL are all it requires). Used only to figure out
 * *where* to post (see postBotMessage below) -- this repo keeps webhook
 * URLs as the one piece of per-subdivision config in Cloudflare env vars,
 * so this avoids needing a whole second set of channel-id env vars just
 * to switch from webhook-posting to bot-posting. Returns null on any
 * failure so a lookup problem never blocks the underlying submission
 * (the caller treats a null channelId as "couldn't post").
 */
// Module-scope cache: a Cloudflare Workers isolate is commonly reused
// across many requests before it's recycled, so a plain in-memory Map
// here works as a cheap best-effort cache without needing KV or any
// other storage binding. A webhook's channel essentially never changes,
// so this used to mean *every single* application/log submission paid
// for a full round-trip to Discord's API just to re-learn the same
// channel id it already knew from the last submission. Falls back to a
// live lookup on a cold isolate or a cache miss, exactly as before.
const webhookChannelIdCache = new Map();
// 10 minutes. Kept short (rather than e.g. 30) because moving an existing
// webhook to a different Discord channel doesn't change its id/token --
// Discord's UI allows this -- so a stale cache entry here doesn't fail
// loudly, it just means postBotMessage keeps succeeding against the OLD
// channel for as long as this TTL lasts, with nothing surfaced anywhere
// that logs/applications are going to a channel nobody's watching.
const WEBHOOK_CHANNEL_CACHE_TTL_MS = 10 * 60 * 1000;

export async function resolveWebhookChannelId(webhookUrl) {
  const parsed = parseWebhookUrl(webhookUrl);
  if (!parsed) return null;
  const cached = webhookChannelIdCache.get(parsed.id);
  if (cached && Date.now() - cached.at < WEBHOOK_CHANNEL_CACHE_TTL_MS) {
    return cached.channelId;
  }
  try {
    const res = await fetch(`https://discord.com/api/webhooks/${parsed.id}/${parsed.token}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const channelId = data?.channel_id || null;
    if (channelId) webhookChannelIdCache.set(parsed.id, { channelId, at: Date.now() });
    return channelId;
  } catch {
    return null;
  }
}

/**
 * Posts a message to a channel using the BOT's own identity (not a
 * webhook). This is required for the Approve/Reject buttons to actually
 * work: per Discord's own docs, "Interactions only work with an
 * application-owned webhook" -- this repo's DISCORD_WEBHOOK_* URLs are
 * plain channel Incoming Webhooks (created by hand in a channel's
 * Integrations settings), which are NOT application-owned, so any
 * interactive component attached to a message posted *through* them can
 * never route a click anywhere -- Discord has no application to hand the
 * interaction to. Posting via the bot sidesteps this entirely, since the
 * message is then owned by this bot's application by construction.
 *
 * Trade-off: unlike a webhook, a bot-sent message can't override its
 * displayed username/avatar per-call, so these no longer show as "BCSO
 * Activity Logs" / "BCSO Applications" with the department crest -- they
 * show as this bot's own account. The embed's `author` field is used to
 * recreate that branding inside the message itself (see log.js/apply.js).
 *
 * Never throws -- returns { ok: false } on any failure so a
 * message-tracking problem never blocks the underlying submission.
 */
export async function postBotMessage(env, channelId, payload) {
  if (!channelId) return { ok: false, error: "No channel id (webhook lookup failed)." };
  if (!env.DISCORD_BOT_TOKEN) return { ok: false, error: "DISCORD_BOT_TOKEN is not configured." };
  try {
    const res = await fetch(`https://discord.com/api/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text().catch(() => "") };
    }
    const message = await res.json().catch(() => null);
    return {
      ok: true,
      status: res.status,
      messageId: message?.id || null,
      channelId,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Splits a webhook URL into its {id, token}, or null if it doesn't match. */
function parseWebhookUrl(webhookUrl) {
  const match = /\/webhooks\/(\d+)\/([^/?]+)/.exec(webhookUrl || "");
  return match ? { id: match[1], token: match[2] } : null;
}

/**
 * Edits a message the BOT previously sent (see postBotMessage above) --
 * used to attach the Approve/Reject buttons once the submission id is
 * known, and later to update the embed to show "Decision: Accepted by X"
 * (or Rejected) and drop the buttons once someone acts on it, whether
 * that action happened on the website or on Discord. Needs both the
 * channel id and message id (unlike a webhook edit, which only needs the
 * message id) since the Channel Messages API is keyed by channel.
 * Best-effort: a failure here (message deleted, missing permissions,
 * etc.) is logged and swallowed, never thrown back into the caller.
 */
export async function editBotMessage(env, channelId, messageId, body) {
  if (!channelId || !messageId || !env.DISCORD_BOT_TOKEN) return;
  try {
    const res = await fetch(
      `https://discord.com/api/channels/${channelId}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      console.error("Failed to edit Discord message:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Failed to edit Discord message:", err);
  }
}

/**
 * Builds the Approve/Reject action row shown on a submission's Discord
 * embed. The custom_id encodes everything the interactions endpoint
 * needs to act on a click: "bcso_decide:<accept|reject>:<id>:<formType>:<slug>".
 * These buttons render immediately, but only actually respond once
 * DISCORD_PUBLIC_KEY is set and the Interactions Endpoint URL is
 * registered in the Discord Developer Portal (see
 * functions/api/discord/interactions.js) — until then, clicking one
 * shows Discord's generic "This interaction failed" message, which is
 * harmless and doesn't affect the website side of approve/reject at all.
 */
export function buildDecisionComponents(submissionId, formType, subdivisionSlug) {
  const suffix = `${submissionId}:${formType}:${subdivisionSlug}`;
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Approve", custom_id: `bcso_decide:accept:${suffix}` },
        { type: 2, style: 4, label: "Reject", custom_id: `bcso_decide:reject:${suffix}` },
      ],
    },
  ];
}

function hexToBytes(hex) {
  const clean = (hex || "").trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Verifies an incoming Discord Interactions request's ed25519 signature
 * using the Workers-native NODE-ED25519 Web Crypto algorithm (built into
 * the Cloudflare Workers runtime — no extra dependency needed, same
 * philosophy as session.js's HMAC signing). Returns false — never
 * throws — on any missing header, missing key, or malformed signature,
 * so a misconfigured/not-yet-set-up DISCORD_PUBLIC_KEY just means the
 * endpoint rejects every request instead of crashing.
 */
export async function verifyDiscordInteraction(request, rawBody, publicKeyHex) {
  try {
    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    if (!signature || !timestamp || !publicKeyHex) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      "NODE-ED25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch (err) {
    console.error("Discord interaction signature verification failed:", err);
    return false;
  }
}
