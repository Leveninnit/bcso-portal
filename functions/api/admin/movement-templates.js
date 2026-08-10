/**
 * Cloudflare Pages Function
 * /api/admin/movement-templates
 *
 * Lets Command staff manage a set of reusable "movement" templates. Each
 * template has a name, one or more Discord role IDs to ping, and an
 * optional fixed "wording" (e.g. "is being suspended pending
 * investigation") that's baked into every message generated from that
 * template. The dashboard's Deputy Movement tab (department-wide) and
 * each subdivision's own Movement Templates tab use these to generate a
 * ready-to-paste Discord message for a given Discord ID and date, for
 * posting into the movements channel. The Generate tab also lets
 * whoever's posting add their own free-text notes on top (separate from
 * a template's wording) and an "Approved By" mention (a person's or
 * role's Discord ID, resolved to <@id> or <@&id>) — those two are
 * assembled client-side in assets/command-access.js and are never
 * persisted; this API stores the reusable name/role-ping/wording
 * templates themselves.
 *
 * A template with no subdivisionSlug is department-wide (visible and
 * manageable by anyone holding the Command Login role, e.g. the original
 * Suspending/Investigating templates). A template WITH a subdivisionSlug
 * only shows up on that subdivision's own tab, and only that
 * subdivision's command-role holders can manage it.
 *
 * GET    [?div=slug]                                            -> list templates (global, or global + that subdivision's own)
 * POST   { name, roleIds: [".."], wording?, subdivisionSlug? }  -> create
 * PUT    { id, name, roleIds: [".."], wording?, subdivisionSlug? } -> update
 * DELETE ?id=..                                                  -> remove
 *
 * Requires the D1 database bound as "DB", and the movement_templates
 * table plus its `wording` column (see schema.sql / migration-2.sql /
 * migration-3.sql).
 */
import { requireSession } from "../../_lib/auth-guard.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function parseTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    roleIds: row.role_ids_json ? JSON.parse(row.role_ids_json) : [],
    wording: row.wording || "",
    sortOrder: row.sort_order,
    subdivisionSlug: row.subdivision_slug || null,
  };
}
function validShape(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim() &&
    Array.isArray(body.roleIds) &&
    body.roleIds.length > 0 &&
    body.roleIds.every((r) => /^\d{5,25}$/.test(String(r).trim())) &&
    (body.wording === undefined || body.wording === null || typeof body.wording === "string")
  );
}
// Optional per-template fixed wording. Trimmed and length-capped; an
// empty/missing value is stored as NULL (not an empty string) so it
// round-trips cleanly through `row.wording || ""` in parseTemplate.
function sanitizeWording(body) {
  const w = typeof body.wording === "string" ? body.wording.trim().slice(0, 300) : "";
  return w || null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");

  let templates;
  if (div) {
    const session = await requireSession(request, env, div);
    if (!session) return jsonResponse({ error: "Unauthorized." }, 401);
    templates = await env.DB.prepare(
      "SELECT * FROM movement_templates WHERE subdivision_slug IS NULL OR subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(div)
      .all();
  } else {
    const session = await requireSession(request, env);
    if (!session) return jsonResponse({ error: "Unauthorized." }, 401);
    templates = await env.DB.prepare(
      "SELECT * FROM movement_templates WHERE subdivision_slug IS NULL ORDER BY sort_order ASC, id ASC"
    ).all();
  }
  return jsonResponse({ templates: templates.results.map(parseTemplate) }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!validShape(body)) return jsonResponse({ error: "Missing or invalid fields." }, 400);
  const subdivisionSlug = body.subdivisionSlug ? String(body.subdivisionSlug).trim().slice(0, 30) : null;
  const session = subdivisionSlug
    ? await requireSession(request, env, subdivisionSlug)
    : await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `INSERT INTO movement_templates (name, role_ids_json, wording, sort_order, subdivision_slug) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      body.name.trim().slice(0, 100),
      JSON.stringify(body.roleIds.map((r) => String(r).trim())),
      sanitizeWording(body),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 9999,
      subdivisionSlug
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !validShape(body)) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const subdivisionSlug = body.subdivisionSlug ? String(body.subdivisionSlug).trim().slice(0, 30) : null;
  const session = subdivisionSlug
    ? await requireSession(request, env, subdivisionSlug)
    : await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `UPDATE movement_templates
     SET name = ?, role_ids_json = ?, wording = ?, sort_order = ?, subdivision_slug = ?, updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      body.name.trim().slice(0, 100),
      JSON.stringify(body.roleIds.map((r) => String(r).trim())),
      sanitizeWording(body),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
      subdivisionSlug,
      body.id
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ error: "id is required." }, 400);

  // Authorize against the template's *actual* stored scope, not whatever
  // the client claims — a subdivision's command staff should never be
  // able to delete another subdivision's (or the department-wide) templates.
  const existing = await env.DB.prepare("SELECT subdivision_slug FROM movement_templates WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) return jsonResponse({ ok: true }, 200); // already gone

  const session = existing.subdivision_slug
    ? await requireSession(request, env, existing.subdivision_slug)
    : await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare("DELETE FROM movement_templates WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true }, 200);
}
