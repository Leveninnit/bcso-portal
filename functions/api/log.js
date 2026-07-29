/**
 * Cloudflare Pages Function
 * POST /api/log
 *
 * Receives a subdivision activity log entry from log.html, validates +
 * sanitizes it, forwards a formatted embed to Discord (pinging the
 * subdivision's command role and the submitter), and — if a D1
 * database is bound as "DB" — records it so Command Access can
 * list/accept/reject/delete it later. Uses a separate set of webhook
 * secrets from applications so activity logs and applications can be
 * routed to different Discord channels.
 *
 * Optional per-subdivision routing: add a secret named
 * DISCORD_WEBHOOK_<SLUG>_LOG (e.g. DISCORD_WEBHOOK_TEU_LOG). Otherwise
 * falls back to the shared DISCORD_WEBHOOK_LOG.
 *
 * `answers` (optional): an object of { questionId: answerText } for any
 * extra custom questions Command staff configured for this
 * subdivision's log form. Missing/malformed answers never block
 * submission.
 */
import { SUBDIVISION_COMMAND_ROLES } from "../_lib/discord.js";

const FIELD_LIMITS = {
  characterName: 100,
  discordId: 100,
  badgeNumber: 30,
  rank: 60,
  summary: 1024,
  subdivisionName: 80,
};
const MIN_FORM_FILL_MS = 3000; // real humans take at least a few seconds
function clean(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLen);
}
function cleanAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!/^\d+$/.test(String(key))) continue;
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
export async function onRequestPost(context) {
  const { request, env } = context;
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  // --- Anti-spam checks -----------------------------------------------
  if (data.website) {
    return jsonResponse({ ok: true }, 200);
  }
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
    "hoursOnDuty",
    "summary",
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
  const summary = clean(data.summary, FIELD_LIMITS.summary);
  const subdivisionName = clean(data.subdivisionName, FIELD_LIMITS.subdivisionName);
  const subdivisionSlug = clean(data.subdivisionSlug, 30).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const hoursOnDuty = Number(data.hoursOnDuty);
  const answers = cleanAnswers(data.answers);
  if (!Number.isFinite(hoursOnDuty) || hoursOnDuty <= 0 || hoursOnDuty > 24) {
    return jsonResponse({ error: "Hours on duty must be a number between 0 and 24." }, 400);
  }
  if (summary.length < 10) {
    return jsonResponse({ error: "Please write at least 10 characters describing your shift." }, 400);
  }
  // --- Resolve which webhook to send to ---------------------------------
  const perSubKey = `DISCORD_WEBHOOK_${subdivisionSlug.toUpperCase()}_LOG`;
  const webhookUrl = env[perSubKey] || env.DISCORD_WEBHOOK_LOG;
  if (!webhookUrl) {
    console.error("No Discord webhook configured for activity logs (checked", perSubKey, "and DISCORD_WEBHOOK_LOG)");
    return jsonResponse(
      { error: "Activity logging is temporarily unavailable. Please try again later or contact command staff on Discord." },
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
    { name: "Rank", value: rank, inline: true },
    { name: "Subdivision", value: subdivisionName, inline: true },
    { name: "Hours on Duty", value: String(hoursOnDuty), inline: true },
    { name: "Shift Summary", value: summary, inline: false },
  ];
  for (const [, value] of Object.entries(answers)) {
    if (value) fields.push({ name: "Additional Question", value, inline: false });
  }
  const embed = {
    title: `Activity Log — ${subdivisionName}`,
    color: 0x2c5c3a, // BCSO green — visually distinct from gold application embeds
    thumbnail: { url: crestUrl },
    fields,
    footer: { text: "Blaine County Sheriff's Office • Activity Logs" },
    timestamp: new Date().toISOString(),
  };
  // Ping the subdivision's command role (if configured) and the person
  // who submitted the log. Only these two explicitly-allowed IDs can
  // ever ping — nothing typed into the summary field can trigger
  // @everyone or any other mention.
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
    username: "BCSO Activity Logs",
    avatar_url: crestUrl,
    content: mentionParts.length ? mentionParts.join(" ") : undefined,
    embeds: [embed],
    allowed_mentions: allowedMentions,
  };
  try {
    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });
    if (!discordRes.ok) {
      const body = await discordRes.text().catch(() => "");
      console.error("Discord webhook rejected the log:", discordRes.status, body);
      return jsonResponse({ error: "Discord rejected the log entry. Please try again or contact command staff." }, 502);
    }
  } catch (err) {
    console.error("Failed to reach Discord webhook:", err);
    return jsonResponse({ error: "Could not reach Discord right now. Please try again in a moment." }, 502);
  }
  // --- Record it for Command Access (best-effort; never blocks the submitter) ---
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO submissions (subdivision_slug, form_type, discord_id, character_name, badge_number, rank, core_fields_json, answers_json)
         VALUES (?, 'log', ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          subdivisionSlug,
          discordId,
          characterName,
          badgeNumber,
          rank,
          JSON.stringify({ hoursOnDuty, summary }),
          JSON.stringify(answers)
        )
        .run();
    } catch (err) {
      console.error("Failed to record log in D1 (non-fatal):", err);
    }
  }
  return jsonResponse({ ok: true }, 200);
}
// Any method other than POST gets a clean 405 instead of falling through
// to Cloudflare's default static-asset handling.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed. Submit logs via POST." }, 405);
}
