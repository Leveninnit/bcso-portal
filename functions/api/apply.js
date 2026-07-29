/**
 * Cloudflare Pages Function
 * POST /api/apply
 *
 * Receives a subdivision application from apply.html, validates + sanitizes
 * it, builds a formatted Discord embed, and forwards it to a Discord
 * webhook. The webhook URL(s) live only in Cloudflare's environment
 * variables (Settings → Environment variables → add as "Secret" in the
 * Pages dashboard) — they are never present in this repo or in any
 * client-side code, so nobody who views the site's source can find or
 * abuse them.
 *
 * Optional per-subdivision routing: if you want a subdivision's
 * applications to go to a *different* Discord channel, add a secret named
 * DISCORD_WEBHOOK_<SLUG> (e.g. DISCORD_WEBHOOK_TEU). Otherwise everything
 * falls back to DISCORD_WEBHOOK_URL.
 */
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
  if (whyJoin.length < 20) {
    return jsonResponse({ error: "Please write at least 20 characters for 'why do you want to join'." }, 400);
  }
  // --- Resolve which webhook to send to ---------------------------------
  const perSubKey = `DISCORD_WEBHOOK_${subdivisionSlug.toUpperCase()}`;
  const webhookUrl = env[perSubKey] || env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("No Discord webhook configured (checked", perSubKey, "and DISCORD_WEBHOOK_URL)");
    return jsonResponse(
      { error: "Applications are temporarily unavailable. Please try again later or contact command staff on Discord." },
      500
    );
  }
  // --- Build the embed ---------------------------------------------------
  const origin = new URL(request.url).origin;
  const crestUrl = `${origin}/assets/bcso-crest.png`;
  const embed = {
    title: `New ${subdivisionName} Application`,
    color: 0xc9a227, // BCSO gold
    thumbnail: { url: crestUrl },
    fields: [
      { name: "Character Name", value: characterName, inline: true },
      { name: "Discord Username", value: discordId, inline: true },
      { name: "Badge Number", value: badgeNumber, inline: true },
      { name: "Current Rank", value: rank, inline: true },
      { name: "Subdivision", value: subdivisionName, inline: true },
      { name: "​", value: "​", inline: true }, // spacer for a clean 2-column grid
      { name: "Why do you want to join?", value: whyJoin, inline: false },
      { name: "Relevant Experience", value: experience, inline: false },
    ],
    footer: { text: "Blaine County Sheriff's Office • Applications Portal" },
    timestamp: new Date().toISOString(),
  };
  const discordPayload = {
    username: "BCSO Applications",
    avatar_url: crestUrl,
    embeds: [embed],
    // Belt-and-braces: even if someone smuggles "@everyone" into a text
    // field, Discord will render it as plain text, never as a real ping.
    allowed_mentions: { parse: [] },
  };
  try {
    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });
    if (!discordRes.ok) {
      const body = await discordRes.text().catch(() => "");
      console.error("Discord webhook rejected the message:", discordRes.status, body);
      return jsonResponse({ error: "Discord rejected the application. Please try again or contact command staff." }, 502);
    }
  } catch (err) {
    console.error("Failed to reach Discord webhook:", err);
    return jsonResponse({ error: "Could not reach Discord right now. Please try again in a moment." }, 502);
  }
  return jsonResponse({ ok: true }, 200);
}
// Any method other than POST gets a clean 405 instead of falling through
// to Cloudflare's default static-asset handling.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed. Submit applications via POST." }, 405);
}
