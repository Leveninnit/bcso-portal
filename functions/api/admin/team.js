/**
 * Cloudflare Pages Function
 * GET/PUT /api/admin/team
 *
 * Command-staff-only endpoint for editing the "Meet the Team" High
 * Command roster shown on the public team.html page. Gated to whoever
 * is signed in AND holds the High Command Discord role -- the
 * isHighCommand flag set on the session payload at login (see
 * functions/api/auth/callback.js). Reuses the same requireSession(...)
 * helper every other command-staff endpoint uses; calling it with no
 * subdivisionSlug argument checks only that the caller is logged in,
 * so the High Command check below is what actually gates this route.
 *
 * GET returns the current roster (same shape as the public endpoint).
 * PUT replaces exactly one slot at a time, keyed by slotNumber (1-5) --
 * the client sends one slot's fields, not the whole roster, so editing
 * one card can't accidentally clobber the others.
 */

import { requireSession } from "../../_lib/auth-guard.js";

const MAX_SLOTS = 5;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function checkAccess(request, env) {
  const session = await requireSession(request, env);
  if (!session) return { ok: false, status: 401 };
  if (!session.isHighCommand) return { ok: false, status: 403 };
  return { ok: true, session };
}

function accessDeniedResponse(status) {
  return jsonResponse(
    { error: status === 401 ? "Not signed in." : "High Command access required." },
    status
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const access = await checkAccess(request, env);
  if (!access.ok) return accessDeniedResponse(access.status);

  if (!env.DB) return jsonResponse({ roster: [] }, 200);

  try {
    const { results } = await env.DB.prepare(
      "SELECT slot_number, character_name, rank_title, subdivision_slug, bio, photo_url " +
        "FROM team_roster ORDER BY slot_number"
    ).all();
    return jsonResponse({ roster: results || [] }, 200);
  } catch (err) {
    console.error("Failed to load team roster (non-fatal):", err);
    return jsonResponse({ roster: [] }, 200);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const access = await checkAccess(request, env);
  if (!access.ok) return accessDeniedResponse(access.status);

  if (!env.DB) {
    return jsonResponse({ error: "Database not configured." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const slot = Number(body.slotNumber);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    return jsonResponse({ error: `slotNumber must be an integer from 1 to ${MAX_SLOTS}.` }, 400);
  }

  const characterName = (body.characterName || "").toString().slice(0, 100);
  const rankTitle = (body.rankTitle || "").toString().slice(0, 100);
  const subdivisionSlug = (body.subdivisionSlug || "").toString().slice(0, 30);
  const bio = (body.bio || "").toString().slice(0, 1000);
  const photoUrl = (body.photoUrl || "").toString().slice(0, 500);

  try {
    await env.DB.prepare(
      `INSERT INTO team_roster (slot_number, character_name, rank_title, subdivision_slug, bio, photo_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slot_number) DO UPDATE SET
         character_name = excluded.character_name,
         rank_title = excluded.rank_title,
         subdivision_slug = excluded.subdivision_slug,
         bio = excluded.bio,
         photo_url = excluded.photo_url,
         updated_at = excluded.updated_at`
    )
      .bind(slot, characterName, rankTitle, subdivisionSlug, bio, photoUrl)
      .run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Failed to save team roster slot:", err);
    return jsonResponse({ error: "Failed to save. Try again." }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET or PUT." }, 405);
}
