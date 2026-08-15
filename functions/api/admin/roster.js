/**
 * Cloudflare Pages Function
 * /api/admin/roster
 *
 * Lets a subdivision's command-role holders manage that subdivision's
 * Roster — shown publicly on that subdivision's own Roster page
 * (roster.html?div=slug, linked from its Documents page). Every
 * subdivision has one, including SRT.
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
 *
 * Every successful write also records who made it and when in
 * content_meta (content_key "roster:<slug>"), which is what powers the
 * "Last updated ... by ..." line shown on this subdivision's public
 * Roster page (roster.html?div=slug) and in this panel -- see
 * functions/api/roster.js and functions/_lib/content-meta.js.
 */
import { requireSession } from "../../_lib/auth-guard.js";
import { touchContentMeta, getContentMeta } from "../../_lib/content-meta.js";

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
  const lastUpdated = await getContentMeta(env, `roster:${div}`);
  return jsonResponse({ entries: (results || []).map(parseEntry), lastUpdated }, 200);
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

  // The next sort_order is computed by a subquery inside this same INSERT
  // statement, rather than a separate SELECT beforehand -- SQLite/D1
  // serializes writes, so folding the read into the write makes the
  // "read current max, then insert one past it" sequence atomic. Two "add
  // roster entry" requests for the same subdivision arriving within
  // milliseconds of each other used to be able to both read the same
  // MAX(sort_order) from a standalone SELECT and then both insert with
  // the same computed value, silently tying two entries on order.
  // rank_since starts now, same as created_at -- a brand-new entry's
  // rank obviously hasn't been held any longer than this (see
  // functions/api/admin/cadet-residency.js, which reads this column).
  await env.DB.prepare(
    `INSERT INTO roster_entries (subdivision_slug, rank, badge_number, callsign, notes, sort_order, rank_since)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roster_entries WHERE subdivision_slug = ?), datetime('now'))`
  )
    .bind(
      body.subdivisionSlug,
      (body.rank || "").toString().trim().slice(0, 100),
      body.badgeNumber.trim().slice(0, 30),
      (body.callsign || "").toString().trim().slice(0, 30),
      (body.notes || "").toString().trim().slice(0, 300),
      body.subdivisionSlug
    )
    .run();

  await touchContentMeta(env, `roster:${body.subdivisionSlug}`, session.username || session.discordId);
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

  const newRank = (body.rank || "").toString().trim().slice(0, 100);
  // rank_since only resets when the Rank text actually changes (compared
  // case-insensitively/trimmed, same convention as the rank-hierarchy
  // matching in functions/api/roster.js) -- editing the badge number,
  // notes, or sort order alone leaves it untouched. The CASE compares
  // against the row's own pre-update `rank` column value, so this stays
  // a single atomic statement instead of a SELECT-then-UPDATE.
  const updateResult = await env.DB.prepare(
    `UPDATE roster_entries
     SET rank = ?, badge_number = ?, callsign = ?, notes = ?, sort_order = ?,
         rank_since = CASE
           WHEN LOWER(TRIM(rank)) = LOWER(TRIM(?)) THEN COALESCE(rank_since, datetime('now'))
           ELSE datetime('now')
         END,
         updated_at = datetime('now')
     WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(
      newRank,
      body.badgeNumber.trim().slice(0, 30),
      (body.callsign || "").toString().trim().slice(0, 30),
      (body.notes || "").toString().trim().slice(0, 300),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
      newRank,
      body.id,
      body.subdivisionSlug
    )
    .run();
  // See documents.js's onRequestPut for why this matters -- a WHERE that
  // matches nothing (stale id) used to still report success.
  if (!updateResult?.meta?.changes) {
    return jsonResponse({ error: "Roster entry not found." }, 404);
  }

  await touchContentMeta(env, `roster:${body.subdivisionSlug}`, session.username || session.discordId);
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

  const deleteResult = await env.DB.prepare("DELETE FROM roster_entries WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  if (deleteResult?.meta?.changes) {
    await touchContentMeta(env, `roster:${div}`, session.username || session.discordId);
  }
  return jsonResponse({ ok: true }, 200);
}
