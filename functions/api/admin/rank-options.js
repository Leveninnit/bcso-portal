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
 * GET    ?div=slug                       -> list options, in order
 * POST   { subdivisionSlug, label }      -> add one
 * PUT    { id, subdivisionSlug, label, sortOrder } -> rename / reorder
 * DELETE ?id=..&div=slug                 -> remove
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
  return { id: row.id, label: row.label, sortOrder: row.sort_order };
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

  const updateResult = await env.DB.prepare(
    `UPDATE rank_options SET label = ?, sort_order = ? WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(
      body.label.trim().slice(0, 100),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
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
