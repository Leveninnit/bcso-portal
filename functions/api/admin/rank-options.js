/**
 * Cloudflare Pages Function
 * /api/admin/rank-options
 *
 * Lets a subdivision's command-role holders manage the list of Rank
 * options shown as a dropdown on that subdivision's Activity Log form,
 * replacing the free-text Rank field once at least one option exists
 * (see /api/rank-options and assets/log.js). RTD is unaffected either
 * way — it already has its own dedicated Rank dropdown wired to the
 * Google Sheet sync, kept as-is.
 *
 * Each option also carries isActivityExempt: whether members holding
 * that rank should show "Exempt" instead of an Active / Semi-Active /
 * Inactive rating on this subdivision's public Roster page. See
 * functions/api/roster.js, which reads this column, and
 * assets/command-access.js's Ranks panel, which exposes the toggle.
 *
 * GET    ?div=slug                                                   -> list options, in order
 * POST   { subdivisionSlug, label }                                  -> add one (starts not activity-exempt)
 * PUT    { id, subdivisionSlug, label, sortOrder, isActivityExempt? } -> rename / reorder / toggle exemption
 * DELETE ?id=..&div=slug                                             -> remove
 *
 * isActivityExempt on PUT is optional: omit it (as the drag-to-reorder
 * save does) to leave whatever's already stored untouched, or pass a
 * boolean to set it explicitly -- see the COALESCE in onRequestPut.
 * Without this, every reorder save would silently reset every rank's
 * exemption flag back to false, since reorder only ever sends label +
 * sortOrder.
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
function parseOption(row) {
  return { id: row.id, label: row.label, sortOrder: row.sort_order, isActivityExempt: !!row.is_activity_exempt };
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
    "SELECT * FROM rank_options WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
  )
    .bind(div)
    .all();
  return jsonResponse({ options: results.map(parseOption) }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.subdivisionSlug || !body.label || typeof body.label !== "string" || !body.label.trim()) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `INSERT INTO rank_options (subdivision_slug, label, sort_order) VALUES (?, ?, ?)`
  )
    .bind(
      body.subdivisionSlug,
      body.label.trim().slice(0, 100),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 9999
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.subdivisionSlug || !body.label || typeof body.label !== "string" || !body.label.trim()) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  // isActivityExempt is optional -- bind null when it's not a boolean so
  // COALESCE keeps whatever's already stored (see this file's header for
  // why: the drag-to-reorder save never sends it, and shouldn't silently
  // clear the flag).
  const exemptBind = typeof body.isActivityExempt === "boolean" ? (body.isActivityExempt ? 1 : 0) : null;
  const updateResult = await env.DB.prepare(
    `UPDATE rank_options SET label = ?, sort_order = ?, is_activity_exempt = COALESCE(?, is_activity_exempt) WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(
      body.label.trim().slice(0, 100),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
      exemptBind,
      body.id,
      body.subdivisionSlug
    )
    .run();
  // See documents.js's onRequestPut for why this matters -- a WHERE that
  // matches nothing (stale id) used to still report success.
  if (!updateResult?.meta?.changes) {
    return jsonResponse({ error: "Rank option not found." }, 404);
  }

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

  await env.DB.prepare("DELETE FROM rank_options WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  return jsonResponse({ ok: true }, 200);
}
