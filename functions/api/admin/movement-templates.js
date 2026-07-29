/**
 * Cloudflare Pages Function
 * /api/admin/movement-templates
 *
 * Lets any Command Access user (anyone holding the Command Login role
 * — this isn't scoped to a specific subdivision, since deputy movement
 * actions like suspension/investigation apply department-wide) manage
 * a set of reusable "movement" templates. Each template has a name and
 * one or more Discord role IDs to ping; the dashboard's Deputy Movement
 * tab uses these to generate a ready-to-paste Discord message for a
 * given Discord ID and date, for posting into the movements channel.
 *
 * GET    -> list all templates
 * POST   { name, roleIds: [".."] }              -> create
 * PUT    { id, name, roleIds: [".."] }          -> update
 * DELETE ?id=..                                  -> remove
 *
 * Requires the D1 database bound as "DB", and the movement_templates
 * table (see schema.sql).
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
    sortOrder: row.sort_order,
  };
}
function validShape(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim() &&
    Array.isArray(body.roleIds) &&
    body.roleIds.length > 0 &&
    body.roleIds.every((r) => /^\d{5,25}$/.test(String(r).trim()))
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const session = await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT * FROM movement_templates ORDER BY sort_order ASC, id ASC"
  ).all();
  return jsonResponse({ templates: results.map(parseTemplate) }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!validShape(body)) return jsonResponse({ error: "Missing or invalid fields." }, 400);
  const session = await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `INSERT INTO movement_templates (name, role_ids_json, sort_order) VALUES (?, ?, ?)`
  )
    .bind(
      body.name.trim().slice(0, 100),
      JSON.stringify(body.roleIds.map((r) => String(r).trim())),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 9999
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
  const session = await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `UPDATE movement_templates
     SET name = ?, role_ids_json = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      body.name.trim().slice(0, 100),
      JSON.stringify(body.roleIds.map((r) => String(r).trim())),
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
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
  const session = await requireSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare("DELETE FROM movement_templates WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true }, 200);
}
