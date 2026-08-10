/**
 * Cloudflare Pages Function
 * POST /api/apply
 *
 * Receives a subdivision application from apply.html, validates +
 * sanitizes it, builds a formatted Discord embed, pings the
 * subdivision's command role plus the applicant, forwards it to a
 * Discord webhook, and (if a D1 database is bound as "DB") records the
 * submission so Command Access can list/accept/reject/delete it later.
 *
 * The webhook URL(s) live only in Cloudflare's environment variables
 * (Settings → Environment variables → add as "Secret" in the Pages
 * dashboard) — they are never present in this repo or in any
 * client-side code.
 *
 * Optional per-subdivision routing: if you want a subdivision's
 * applications to go to a *different* Discord channel, add a secret
 * named DISCORD_WEBHOOK_<SLUG> (e.g. DISCORD_WEBHOOK_TEU). Otherwise
 * everything falls back to DISCORD_WEBHOOK_URL.
 *
 * `answers` (optional): an object of { questionId: answerText } for any
 * extra custom questions Command staff configured for this
 * subdivision's application form (see /api/questions and Command
 * Access). Missing or malformed `answers` never blocks submission —
 * custom questions are additive, not required for the base form to
 * work.
 *
 * New: on top of the Discord channel ping, this also DMs every member
 * holding the subdivision's command role, with a direct link into
 * Command Access for this specific application. Best-effort — run via
 * context.waitUntil() so a slow/failed DM never delays or breaks the
 * applicant's response, and any one DM failing (closed DMs, bot not
 * sharing a server with them, etc.) never affects the others.
 */
import {
  SUBDIVISION_COMMAND_ROLES,
  getGuildMembersWithRole,
  sendDirectMessage,
  resolveWebhookUrl,
  postToWebhookWithId,
  editWebhookMessage,
  buildDecisionComponents,
} from "../_lib/discord.js";

const FIELD_LIMITS = {
  characterName: 100,
  discordId: 100,
  badgeNumber: 30,
  rank: 60,
  whyJoin: 1024,
  experience: 1024,
  subdivisionName: 80,
};
const MIN_FORM_FILL_MS = 3000; // real humans take at least a few seconds
function clean(value, maxLen) {
  if (typeof value !== "string") return "";
  // Trim, collapse excessive whitespace, hard-truncate to Discord's limits.
  return value.trim().replace(/\s+/g, " ").slice(0, maxLen);
}
function cleanAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!/^\d+$/.test(String(key))) continue; // question ids are numeric
    out[key] = clean(String(value ?? ""), 500);
  }
  return out;
}
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * DMs every member holding a subdivision's command role. Best-effort and
 * non-fatal — a failure here (bot not in the server, Server Members
 * Intent off, rate limit, etc.) is logged and swallowed so it never
 * throws back into the caller.
 */
async function notifyCommandStaffByDm(env, roleId, message) {
  try {
    const memberIds = await getGuildMembersWithRole(env, roleId);
    for (const userId of memberIds) {
      await sendDirectMessage(env, userId, message);
    }
  } catch (err) {
    console.error("Failed to DM command staff about new application:", err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  // --- Anti-spam checks -----------------------------------------------
  // Honeypot: bots that fill in every field trip this. Pretend success so
  // they don't learn anything, but never forward it to Discord.
  if (data.website) {
    return jsonResponse({ ok: true }, 200);
  }
  // Submitted implausibly fast after the page loaded = almost certainly a
  // scripted bot, not a person reading the form. Same "fake success" trick.
  const loadedAt = Number(data.formLoadedAt);
  if (!loadedAt || Date.now() - loadedAt < MIN_FORM_FILL_MS) {
    return jsonResponse({ ok: true }, 200);
  }
  // --- Validation -------------------------------------------------------
  const required = [
    "characterName",
    "discordId",
    "badgeNumber",
    "rank",
    "whyJoin",
    "experience",
    "subdivisionSlug",
    "subdivisionName",
  ];
  for (const field of required) {
    if (!data[field] || typeof data[field] !== "string" || !data[field].trim()) {
      return jsonResponse({ error: `Missing required field: ${field}` }, 400);
    }
  }
  const characterName = clean(data.characterName, FIELD_LIMITS.characterName);
  const discordId = clean(data.discordId, FIELD_LIMITS.discordId);
  const badgeNumber = clean(data.badgeNumber, FIELD_LIMITS.badgeNumber);
  const rank = clean(data.rank, FIELD_LIMITS.rank);
  const whyJoin = clean(data.whyJoin, FIELD_LIMITS.whyJoin);
  const experience = clean(data.experience, FIELD_LIMITS.experience);
  const subdivisionName = clean(data.subdivisionName, FIELD_LIMITS.subdivisionName);
  const subdivisionSlug = clean(data.subdivisionSlug, 30).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const answers = cleanAnswers(data.answers);
  if (whyJoin.length < 20) {
    return jsonResponse({ error: "Please write at least 20 characters for 'why do you want to join'." }, 400);
  }
  // --- Resolve which webhook to send to ---------------------------------
  const webhookUrl = resolveWebhookUrl(env, "application", subdivisionSlug);
  if (!webhookUrl) {
    console.error("No Discord webhook configured for applications for subdivision", subdivisionSlug);
    return jsonResponse(
      { error: "Applications are temporarily unavailable. Please try again later or contact command staff." },
      500
    );
  }
  // --- Build the embed ---------------------------------------------------
  const origin = new URL(request.url).origin;
  const crestUrl = `${origin}/assets/bcso-crest.png`;
  const fields = [
    { name: "Character Name", value: characterName, inline: true },
    { name: "Discord ID", value: discordId, inline: true },
    { name: "Badge Number", value: badgeNumber, inline: true },
    { name: "Current Rank", value: rank, inline: true },
    { name: "Subdivision", value: subdivisionName, inline: true },
    { name: "​", value: "​", inline: true }, // spacer for a clean 2-column grid
    { name: "Why do you want to join?", value: whyJoin, inline: false },
    { name: "Relevant Experience", value: experience, inline: false },
  ];
  for (const [, value] of Object.entries(answers)) {
    if (value) fields.push({ name: "Additional Question", value, inline: false });
  }
  const embed = {
    title: `New ${subdivisionName} Application`,
    color: 0xc9a227, // BCSO gold
    thumbnail: { url: crestUrl },
    fields,
    footer: { text: "Blaine County Sheriff's Office • Applications Portal" },
    timestamp: new Date().toISOString(),
  };
  // Ping the subdivision's command role (if one's configured) and the
  // applicant themselves, so nobody has to go looking for this. Real
  // pings only happen for these two explicitly-allowed IDs — nothing a
  // user types in a text field can trigger @everyone or any other ping.
  const commandRoleId = SUBDIVISION_COMMAND_ROLES[subdivisionSlug];
  const mentionParts = [];
  const allowedMentions = { parse: [], roles: [], users: [] };
  if (commandRoleId) {
    mentionParts.push(`<@&${commandRoleId}>`);
    allowedMentions.roles.push(commandRoleId);
  }
  if (/^\d{15,25}$/.test(discordId)) {
    mentionParts.push(`<@${discordId}>`);
    allowedMentions.users.push(discordId);
  }
  const discordPayload = {
    username: "BCSO Applications",
    avatar_url: crestUrl,
    content: mentionParts.length ? mentionParts.join(" ") : undefined,
    embeds: [embed],
    allowed_mentions: allowedMentions,
  };
  const postResult = await postToWebhookWithId(webhookUrl, discordPayload);
  if (!postResult.ok) {
    console.error("Discord webhook rejected the message:", postResult.status, postResult.body || postResult.error);
    return jsonResponse({ error: "Discord rejected the application. Please try again or contact command staff." }, 502);
  }
  // --- Record it for Command Access (best-effort; never blocks the applicant) ---
  let submissionId = null;
  if (env.DB) {
    try {
      const insertResult = await env.DB.prepare(
        `INSERT INTO submissions (subdivision_slug, form_type, discord_id, character_name, badge_number, rank, core_fields_json, answers_json, discord_message_id, discord_channel_id)
         VALUES (?, 'application', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          subdivisionSlug,
          discordId,
          characterName,
          badgeNumber,
          rank,
          JSON.stringify({ whyJoin, experience }),
          JSON.stringify(answers),
          postResult.messageId,
          postResult.channelId
        )
        .run();
      submissionId = insertResult?.meta?.last_row_id ?? null;
    } catch (err) {
      console.error("Failed to record application in D1 (non-fatal):", err);
    }
  }
  // --- Attach Approve/Reject buttons now that we know the submission id ---
  if (submissionId && postResult.messageId) {
    context.waitUntil(
      editWebhookMessage(webhookUrl, postResult.messageId, {
        components: buildDecisionComponents(submissionId, "application", subdivisionSlug),
      })
    );
  }
  // --- DM the subdivision's command staff with a direct link (best-effort) ---
  if (submissionId && commandRoleId) {
    const reviewLink = `${origin}/command-access.html?div=${encodeURIComponent(subdivisionSlug)}&type=application&id=${submissionId}`;
    const dmMessage = `📋 New **${subdivisionName}** application from **${characterName}** — review it here: ${reviewLink}`;
    context.waitUntil(notifyCommandStaffByDm(env, commandRoleId, dmMessage));
  }
  return jsonResponse({ ok: true }, 200);
}
// Any method other than POST gets a clean 405 instead of falling through
// to Cloudflare's default static-asset handling.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed. Submit applications via POST." }, 405);
}
