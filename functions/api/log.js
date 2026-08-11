/**
 * Cloudflare Pages Function
 * POST /api/log
 *
 * Receives a subdivision activity log entry from log.html, validates +
 * sanitizes it, and forwards a formatted embed to Discord — pinging that
 * subdivision's command role (see SUBDIVISION_COMMAND_ROLES) the same way
 * apply.js already does for applications, plus an Approve/Reject button
 * pair so command staff can act on it straight from Discord (requires
 * DISCORD_PUBLIC_KEY to be set — see functions/api/discord/interactions.js).
 * For RTD specifically, also forwards the submission to a Google Apps
 * Script Web App that appends a row to the Master Roster's 'RTD |
 * Activation Logs' tab — the same tab the "BCSO | RTD | Activation Form"
 * Google Form writes to — so portal submissions show up in the roster's
 * hour/contribution totals exactly like a Form submission would.
 *
 * RTD's Assist/Host/Supervise branches each swap their normal
 * FTO/Cadet/Supervised-person fields for a simple recruited-person
 * Discord ID list (one or more) when their Type dropdown is "Open
 * Recruitment" (Host also offers "Discord Recruitment") — see cleanRtd's
 * *Recruits arrays below. NOTE: those arrays are new; the Apps Script
 * (Code.gs, not part of this repo) may need a small update on the Google
 * side to actually place recruited people into the sheet — this endpoint
 * just forwards the data.
 *
 * Host -> "Discord Recruitment" is further special-cased as having no
 * on-duty shift at all — it's just a note that a recruitment happened
 * over Discord — so Duration on Duty and Shift Summary are both skipped
 * (not required, forced to 0/empty, left out of the Discord embed and
 * the Apps Script payload's *Duration field) via `isDiscordRecruitment`
 * below. Every other role/type combination is unaffected.
 *
 * Duration is collected as separate hours/minutes/seconds fields (not a
 * single decimal-hours number) so shifts can be logged down to the
 * second. Internally this is still also expressed as decimal hours
 * (`hoursOnDuty`) for backward compatibility with the existing Google
 * Sheet sync functions below, which expect that shape.
 *
 * New Cloudflare environment variables (Settings -> Environment
 * variables, Encrypt both):
 *   SHEET_LOG_WEBHOOK_URL   The Apps Script /exec URL (see Code.gs).
 *   SHEET_LOG_SECRET        Must match the SHARED_SECRET script
 *                           property set in that Apps Script project.
 * If either is missing, the sheet-write step is silently skipped and
 * everything else (Discord notifications) keeps working as before.
 */
import {
  SUBDIVISION_COMMAND_ROLES,
  resolveWebhookUrl,
  resolveWebhookChannelId,
  postBotMessage,
  editBotMessage,
  buildDecisionComponents,
} from "../_lib/discord.js";

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
  // See apply.js's clean() for why this preserves single line breaks
  // instead of collapsing all whitespace (including newlines) to one
  // space -- that used to flatten multi-line Shift Summaries into a
  // single unreadable line.
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// "2.5" hours -> "2:30:00", matching the H:MM:SS text the Google Form's
// duration questions produce.
function hoursToHms(hoursDecimal) {
  const totalSeconds = Math.round(Number(hoursDecimal) * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Validates and clamps a duration component (hours/minutes/seconds) sent
// from the form. Returns null (not 0) for anything missing/invalid so the
// caller can tell "not provided / bad input" apart from an honest 0.
function toNonNegInt(value, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

// "2h 30m 15s" — the human-readable duration shown on the Discord embed
// and in Command Access, built directly from the submitted H/M/S so there
// is no floating-point round-tripping through decimal hours.
function formatDuration(h, m, s) {
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function cleanAnswers(answers) {
  // typeof [] === "object" too, so this excludes arrays explicitly --
  // otherwise `answers: [...]` slipped past the shape check and got keyed
  // by array index (Object.entries([...]) yields "0", "1", ... keys)
  // instead of being rejected as the wrong shape.
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!/^\d+$/.test(String(key))) continue; // question ids are numeric
    out[key] = clean(String(value ?? ""), 500);
  }
  return out;
}

function cleanRtd(rtd) {
  const r = rtd && typeof rtd === "object" ? rtd : {};
  const c = (v) => clean(v, 60);
  const cadets = Array.isArray(r.cadets) ? r.cadets : [];
  // "Open Recruitment" swaps the FTO/Cadet/Supervised-person fields for a
  // simple list of recruited people's Discord IDs — capped well above any
  // real single-session recruitment count as an anti-abuse backstop.
  const cleanRecruits = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((v) => clean(v, 100))
      .filter(Boolean)
      .slice(0, 25);
  return {
    role: c(r.role), // "assist" | "host" | "supervise"
    assistType: c(r.assistType),
    ftoBadge: c(r.ftoBadge),
    ftoDiscordId: c(r.ftoDiscordId),
    assistRecruits: cleanRecruits(r.assistRecruits),
    hostType: c(r.hostType),
    cadets: [0, 1, 2, 3].map((i) => ({
      badge: c(cadets[i] && cadets[i].badge),
      discordId: c(cadets[i] && cadets[i].discordId),
      result: c(cadets[i] && cadets[i].result),
      notes: clean(cadets[i] && cadets[i].notes, 500),
    })),
    hostRecruits: cleanRecruits(r.hostRecruits),
    superviseType: c(r.superviseType),
    supervisedBadge: c(r.supervisedBadge),
    supervisedDiscordId: c(r.supervisedDiscordId),
    superviseRecruits: cleanRecruits(r.superviseRecruits),
  };
}

// Best-effort forward to the Google Sheet via Apps Script. Never throws —
// a failure here should not block the Discord notification from succeeding.
async function forwardToSheet(env, { badgeNumber, discordId, rank, hoursOnDuty, rtd }) {
  if (!env.SHEET_LOG_WEBHOOK_URL || !env.SHEET_LOG_SECRET) return;
  try {
    const hms = hoursToHms(hoursOnDuty);
    const isAssist = rtd.role === "assist";
    const isHost = rtd.role === "host";
    const isSupervise = rtd.role === "supervise";

    const payload = {
      token: env.SHEET_LOG_SECRET,
      badgeNumber,
      discordId,
      rank,
      role: isAssist
        ? "Assisting with a Training, Ride-along, or Recruitment"
        : isHost
        ? "Hosting a Training, Ride-along, or Recruitment"
        : isSupervise
        ? "Supervising a Training, Ride-along, or Recruitment"
        : "",
      assistType: isAssist ? rtd.assistType : "",
      assistDuration: isAssist ? hms : "",
      ftoBadge: isAssist ? rtd.ftoBadge : "",
      ftoDiscordId: isAssist ? rtd.ftoDiscordId : "",
      // "Open Recruitment" fills *Recruits instead of the fields above —
      // an array of the recruited people's Discord IDs. NOTE: the Apps
      // Script this webhook posts to (Code.gs, outside this repo) may
      // need a small update to actually place these into the sheet; this
      // is a new field the original Google Form/script never sent.
      assistRecruits: isAssist ? rtd.assistRecruits : [],
      hostType: isHost ? rtd.hostType : "",
      // "Discord Recruitment" has no shift/duration at all (see the file
      // header) — send an empty string rather than a misleading "0:00:00".
      hostDuration: isHost && rtd.hostType !== "Discord Recruitment" ? hms : "",
      cadets: isHost ? rtd.cadets : [],
      hostRecruits: isHost ? rtd.hostRecruits : [],
      superviseType: isSupervise ? rtd.superviseType : "",
      supervisedBadge: isSupervise ? rtd.supervisedBadge : "",
      supervisedDiscordId: isSupervise ? rtd.supervisedDiscordId : "",
      superviseRecruits: isSupervise ? rtd.superviseRecruits : [],
    };

    const res = await fetch(env.SHEET_LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Sheet sync rejected the log:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Failed to forward log to Google Sheet:", err);
  }
}

// SRT only: look up this subdivision's custom question IDs by label so we
// can pull the right answers out of the opaque answers object (keyed by
// numeric question id) and forward them to the Google Sheet.
async function getSrtQuestionIds(env) {
  if (!env.DB) return {};
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, label FROM questions WHERE subdivision_slug = 'srt' AND form_type = 'log'"
    ).all();
    const map = {};
    for (const row of results || []) {
      const label = String(row.label || "").trim().toLowerCase();
      if (label.startsWith("reason to clock-in")) map.reason = row.id;
      else if (label.startsWith("did you discharge your weapon")) map.weaponDischarge = row.id;
      else if (label.startsWith("number of casualties")) map.casualties = row.id;
      else if (label.startsWith("electronic signature")) map.signature = row.id;
    }
    return map;
  } catch (err) {
    console.error("Failed to load SRT question ids (non-fatal):", err);
    return {};
  }
}

// Best-effort forward to the Google Sheet via Apps Script for SRT. Mirrors
// forwardToSheet's RTD behavior above, but targets the SRT web app and
// secret and pulls its 4 custom-question answers out of the answers
// object by matching each question's label (since answers is keyed by
// opaque numeric question ids that can change if questions are re-created).
async function forwardSrtLogToSheet(env, { discordId, rank, hoursOnDuty, summary, answers }) {
  if (!env.SRT_SHEET_LOG_WEBHOOK_URL || !env.SRT_SHEET_LOG_SECRET) return;
  try {
    const ids = await getSrtQuestionIds(env);
    const payload = {
      token: env.SRT_SHEET_LOG_SECRET,
      discordId,
      rank,
      reason: ids.reason ? answers[String(ids.reason)] || "" : "",
      duration: hoursToHms(hoursOnDuty),
      summary,
      weaponDischarge: ids.weaponDischarge ? answers[String(ids.weaponDischarge)] || "" : "",
      casualties: ids.casualties ? answers[String(ids.casualties)] || "" : "",
      signature: ids.signature ? answers[String(ids.signature)] || "" : "",
    };

    const res = await fetch(env.SRT_SHEET_LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("SRT sheet sync rejected the log:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Failed to forward SRT log to Google Sheet:", err);
  }
}

// Best-effort forward to the Google Sheet via Apps Script for OCD. Mirrors
// forwardSrtLogToSheet's behavior above, but targets the OCD web app and
// secret and pulls its 2 custom-question answers (division, signature) out
// of the answers object by matching each question's label.
async function getOcdQuestionIds(env) {
  if (!env.DB) return {};
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, label FROM questions WHERE subdivision_slug = 'ocd' AND form_type = 'log'"
    ).all();
    const map = {};
    for (const row of results || []) {
      const label = String(row.label || "").trim().toLowerCase();
      if (label.startsWith("what division")) map.division = row.id;
      else if (label.startsWith("electronic signature")) map.signature = row.id;
    }
    return map;
  } catch (err) {
    console.error("Failed to load OCD question ids:", err);
    return {};
  }
}

async function forwardOcdLogToSheet(env, { discordId, rank, characterName, badgeNumber, hoursOnDuty, summary, answers }) {
  if (!env.OCD_SHEET_LOG_WEBHOOK_URL || !env.OCD_SHEET_LOG_SECRET) return;
  try {
    const ids = await getOcdQuestionIds(env);
    const payload = {
      token: env.OCD_SHEET_LOG_SECRET,
      discordId,
      rank,
      rpName: characterName,
      badgeNumber,
      division: ids.division ? answers[String(ids.division)] || "" : "",
      duration: hoursToHms(hoursOnDuty),
      summary,
      signature: ids.signature ? answers[String(ids.signature)] || "" : "",
    };
    const res = await fetch(env.OCD_SHEET_LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("OCD sheet sync rejected the log:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Failed to forward OCD log to Google Sheet:", err);
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
  if (data.website) {
    return jsonResponse({ ok: true }, 200);
  }
  const loadedAt = Number(data.formLoadedAt);
  if (!loadedAt || Date.now() - loadedAt < MIN_FORM_FILL_MS) {
    return jsonResponse({ ok: true }, 200);
  }

  // --- Validation -------------------------------------------------------
  // "summary" is intentionally not in this blanket list — RTD's Host ->
  // "Discord Recruitment" has no Shift Summary at all (see below), so it's
  // validated separately once we know whether that case applies.
  const required = [
    "characterName",
    "discordId",
    "badgeNumber",
    "rank",
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
  const answers = cleanAnswers(data.answers);

  // RTD only, parsed early: Host -> "Discord Recruitment" isn't an
  // on-duty shift, just a note that a recruitment happened over Discord,
  // so it has no Duration on Duty or Shift Summary — both requirements
  // are skipped for it below.
  const rtd = subdivisionSlug === "rtd" ? cleanRtd(data.rtd) : null;
  const isDiscordRecruitment = !!rtd && rtd.role === "host" && rtd.hostType === "Discord Recruitment";

  const durationHours = isDiscordRecruitment ? 0 : toNonNegInt(data.durationHours, 24);
  const durationMinutes = isDiscordRecruitment ? 0 : toNonNegInt(data.durationMinutes, 59);
  const durationSeconds = isDiscordRecruitment ? 0 : toNonNegInt(data.durationSeconds, 59);
  if (durationHours === null || durationMinutes === null || durationSeconds === null) {
    return jsonResponse({ error: "Please enter a valid duration (hours, minutes, seconds)." }, 400);
  }
  const totalSeconds = durationHours * 3600 + durationMinutes * 60 + durationSeconds;
  if (!isDiscordRecruitment && (totalSeconds <= 0 || totalSeconds > 24 * 3600)) {
    return jsonResponse({ error: "Duration must be between 1 second and 24 hours." }, 400);
  }
  const hoursOnDuty = totalSeconds / 3600; // decimal, kept for the sheet-sync functions below
  const durationDisplay = isDiscordRecruitment ? "" : formatDuration(durationHours, durationMinutes, durationSeconds);

  if (!isDiscordRecruitment && summary.length < 10) {
    return jsonResponse({ error: "Please write at least 10 characters describing your shift." }, 400);
  }

  if (rtd) {
    if (!["assist", "host", "supervise"].includes(rtd.role)) {
      return jsonResponse({ error: "Please select your role during this activation." }, 400);
    }
    if (rtd.role === "assist") {
      if (!rtd.assistType) {
        return jsonResponse({ error: "Please select what you assisted with." }, 400);
      }
      if (rtd.assistType === "Open Recruitment") {
        if (!rtd.assistRecruits.length) {
          return jsonResponse({ error: "Please add at least one recruited person's Discord ID." }, 400);
        }
      } else if (!rtd.ftoBadge || !rtd.ftoDiscordId) {
        return jsonResponse({ error: "Please fill in your FTO's badge number and Discord ID." }, 400);
      }
    }
    if (rtd.role === "host") {
      if (!rtd.hostType) {
        return jsonResponse({ error: "Please select what you hosted." }, 400);
      }
      if (rtd.hostType === "Open Recruitment" || rtd.hostType === "Discord Recruitment") {
        if (!rtd.hostRecruits.length) {
          return jsonResponse({ error: "Please add at least one recruited person's Discord ID." }, 400);
        }
      } else {
        const c1 = rtd.cadets[0];
        if (!c1.badge || !c1.discordId || !c1.result) {
          return jsonResponse({ error: "Cadet #1's badge number, Discord ID, and Pass/Fail are required." }, 400);
        }
      }
    }
    if (rtd.role === "supervise") {
      if (!rtd.superviseType) {
        return jsonResponse({ error: "Please select what you supervised." }, 400);
      }
      if (rtd.superviseType === "Open Recruitment") {
        if (!rtd.superviseRecruits.length) {
          return jsonResponse({ error: "Please add at least one recruited person's Discord ID." }, 400);
        }
      } else if (!rtd.supervisedBadge || !rtd.supervisedDiscordId) {
        return jsonResponse({ error: "Please fill in the supervised person's badge number and Discord ID." }, 400);
      }
    }
  }

  // --- Resolve which webhook to send to ---------------------------------
  const webhookUrl = resolveWebhookUrl(env, "log", subdivisionSlug);
  if (!webhookUrl) {
    console.error("No Discord webhook configured for activity logs for subdivision", subdivisionSlug);
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
  ];
  // Discord embed field values can't be empty, and "Discord Recruitment"
  // has no duration to show — so this field is left out entirely for it
  // rather than showing a meaningless "0h 00m 00s".
  if (!isDiscordRecruitment) {
    fields.push({ name: "Duration", value: durationDisplay, inline: true });
  }
  if (rtd) {
    if (rtd.role === "assist") {
      fields.push(
        { name: "Role", value: "Assist", inline: true },
        { name: "Assisted With", value: rtd.assistType, inline: true }
      );
      if (rtd.assistType === "Open Recruitment" && rtd.assistRecruits.length) {
        fields.push({ name: "Recruited", value: rtd.assistRecruits.join("\n"), inline: false });
      } else {
        fields.push({ name: "FTO", value: `${rtd.ftoBadge} (${rtd.ftoDiscordId})`, inline: true });
      }
    } else if (rtd.role === "host") {
      fields.push(
        { name: "Role", value: "Host", inline: true },
        { name: "Hosted", value: rtd.hostType, inline: true }
      );
      if ((rtd.hostType === "Open Recruitment" || rtd.hostType === "Discord Recruitment") && rtd.hostRecruits.length) {
        fields.push({ name: "Recruited", value: rtd.hostRecruits.join("\n"), inline: false });
      } else {
        rtd.cadets
          .filter((c) => c.badge || c.discordId)
          .forEach((c, i) => {
            fields.push({
              name: `Cadet #${i + 1}`,
              value: `${c.badge} (${c.discordId}) — ${c.result}${c.notes ? " — " + c.notes : ""}`,
              inline: false,
            });
          });
      }
    } else if (rtd.role === "supervise") {
      fields.push(
        { name: "Role", value: "Supervise", inline: true },
        { name: "Supervised", value: rtd.superviseType, inline: true }
      );
      if (rtd.superviseType === "Open Recruitment" && rtd.superviseRecruits.length) {
        fields.push({ name: "Recruited", value: rtd.superviseRecruits.join("\n"), inline: false });
      } else {
        fields.push({ name: "Supervised Person", value: `${rtd.supervisedBadge} (${rtd.supervisedDiscordId})`, inline: true });
      }
    }
  }
  // Same empty-value rule as Duration above — "Discord Recruitment" has
  // no Shift Summary, so skip the field instead of pushing an empty one.
  if (!isDiscordRecruitment && summary) {
    fields.push({ name: "Shift Summary", value: summary, inline: false });
  }

  const embed = {
    // Posted by the bot now (see below) instead of through a webhook, so
    // this no longer shows as "BCSO Activity Logs" with the crest as the
    // message's own author — the embed's own `author` field recreates
    // that branding instead.
    author: { name: "BCSO Activity Logs", icon_url: crestUrl },
    title: `Activity Log — ${subdivisionName}`,
    color: 0x2c5c3a, // BCSO green — visually distinct from gold application embeds
    thumbnail: { url: crestUrl },
    fields,
    footer: { text: "Blaine County Sheriff's Office • Activity Logs" },
    timestamp: new Date().toISOString(),
  };

  // Ping the subdivision's command role, same as applications already do.
  // Real pings only happen for this one explicitly-allowed role ID —
  // nothing a user types in a text field can trigger @everyone or any
  // other ping.
  const commandRoleId = SUBDIVISION_COMMAND_ROLES[subdivisionSlug];
  const discordPayload = {
    content: commandRoleId ? `<@&${commandRoleId}>` : undefined,
    embeds: [embed],
    allowed_mentions: { parse: [], roles: commandRoleId ? [commandRoleId] : [] },
  };

  // Posted via the bot (not the webhook execute endpoint) -- Discord only
  // routes button clicks to an application, and a plain channel webhook
  // isn't one, so buttons attached to a webhook-posted message can never
  // work. The webhook URL is still how this channel is configured (no new
  // env vars needed) -- it's just used to look up the channel id here.
  const logChannelId = await resolveWebhookChannelId(webhookUrl);
  const postResult = await postBotMessage(env, logChannelId, discordPayload);
  if (!postResult.ok) {
    console.error("Discord bot post rejected the log:", postResult.status, postResult.body || postResult.error);
    return jsonResponse({ error: "Discord rejected the log entry. Please try again or contact command staff." }, 502);
  }

  // --- RTD only: mirror this submission into the Master Roster sheet ----
  if (rtd) {
    await forwardToSheet(env, { badgeNumber, discordId, rank, hoursOnDuty, rtd });
  }

  // --- SRT only: mirror this submission into the SRT Database sheet ----
  if (subdivisionSlug === "srt") {
    await forwardSrtLogToSheet(env, { discordId, rank, hoursOnDuty, summary, answers });
  }
  if (subdivisionSlug === "ocd") {
    await forwardOcdLogToSheet(env, { discordId, rank, characterName, badgeNumber, hoursOnDuty, summary, answers });
  }

  // --- Record it for Command Access (best-effort; never blocks the submitter) ---
  let submissionId = null;
  if (env.DB) {
    try {
      const insertResult = await env.DB.prepare(
        `INSERT INTO submissions (subdivision_slug, form_type, discord_id, character_name, badge_number, rank, core_fields_json, answers_json, discord_message_id, discord_channel_id)
         VALUES (?, 'log', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          subdivisionSlug,
          discordId,
          characterName,
          badgeNumber,
          rank,
          JSON.stringify({ durationSeconds: totalSeconds, durationDisplay, summary, rtd }),
          JSON.stringify(answers),
          postResult.messageId,
          postResult.channelId
        )
        .run();
      submissionId = insertResult?.meta?.last_row_id ?? null;
    } catch (err) {
      console.error("Failed to record activity log in D1 (non-fatal):", err);
    }
  }

  // --- Attach Approve/Reject buttons now that we know the submission id ---
  if (submissionId && postResult.messageId) {
    context.waitUntil(
      editBotMessage(env, postResult.channelId, postResult.messageId, {
        components: buildDecisionComponents(submissionId, "log", subdivisionSlug),
      })
    );
  }

  return jsonResponse({ ok: true }, 200);
}

// Any method other than POST gets a clean 405 instead of falling through
// to Cloudflare's default static-asset handling.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed. Submit logs via POST." }, 405);
}
