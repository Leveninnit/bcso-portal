/**
 * Cloudflare Pages Function
 * /api/admin/roster
 *
 * Lets a subdivision's command-role holders manage that subdivision's
 * Roster — shown publicly on that subdivision's Documents page
 * (documents.html?div=slug). Every subdivision has one, including SRT.
 *
 * Each entry only stores Rank + Badge Number (+ optional Notes) and a
 * manual sort order — Character Name, Discord ID, and Department Status
 * are NOT stored here. They're resolved live from the Master Roster
 * Google Sheet by badge number every time the roster is viewed (see
 * functions/api/roster.js and functions/_lib/roster-sheet.js), so an
 * entry never goes stale when someone's name or status changes there.
 *
 * The "callsign" column still exists in the database for backward
 * compatibility but is no longer collected by the Roster form or shown
 * publicly (replaced by the auto-resolved Department Status) — safe to
 * ignore.
 *
 * GET    ?div=slug                                          -> list entries, in order
 * POST   { subdivisionSlug, rank, badgeNumber, notes }      -> add one
 * PUT    { id, subdivisionSlug, rank, badgeNumber, notes, sortOrder } -> edit
 * DELETE ?id=..&div=slug                                    -> remove
 *
 * Every write requires a valid Command Access session for that exact
 * subdivision. Requires the D1 database bound as "DB".
 */
import { requireSession } from "../../_lib/auth-guard.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function parseEntry(row) {
  return {
    id: row.id,
    subdivisionSlug: row.subdivision_slug,
    rank: row.rank,
    badgeNumber: row.badge_number,
    callsign: row.callsign,
    notes: row.notes,
    sortOrder: row.sort_order,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div) return jsonResponse({ error: "div is required." }, 400);
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT * FROM roster_entries WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
  )
    .bind(div)
    .all();
  return jsonResponse({ entries: (results || []).map(parseEntry) }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.subdivisionSlug || !body.badgeNumber || typeof body.badgeNumber !== "string" || !body.badgeNumber.trim()) {
    return jsonResponse({ error: "Missing or invalid fields — a Badge Number is required." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM roster_entries WHERE subdivision_slug = ?"
  )
    .bind(body.subdivisionSlug)
    .all();
  const nextOrder = (results && results[0] && Number(results[0].maxOrder)) || 0;

  await env.DB.prepare(
    `INSERT INTO roster_entries (subdivision_slug, rank, badge_number, callsign, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.subdivisionSlug,
      (body.rank || "").toString().trim().slice(0, 100),
      body.badgeNumber.trim().slice(0, 30),
      (body.callsign || "").toString().trim().slice(0, 30),
      (body.notes || "").toString().trim().slice(0, 300),
      nextOrder + 1
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.subdivisionSlug || !body.badgeNumber || typeof body.badgeNumber !== "string" || !body.badgeNumber.trim()) {
    return jsonResponse({ error: "Missing or invalid fields — a Badge Number is required." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `UPDATE roster_entries SET rank = ?, badge_number = ?, callsign = ?, notes = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(
      (body.rank || "").toString().trim().slice(0, 100),
      body.badgeNumber.trim().slice(0, 30),
      (body.callsign || "").toString().trim().slice(0, 30),
      (body.notes || "").toString().trim().slice(0, 300),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
      body.id,
      body.subdivisionSlug
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const div = url.searchParams.get("div");
  if (!id || !div) return jsonResponse({ error: "id and div are required." }, 400);
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare("DELETE FROM roster_entries WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  return jsonResponse({ ok: true }, 200);
}
