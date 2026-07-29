/**
 * Cloudflare Pages Function
 * /api/admin/submissions
 *
 * Lets a subdivision's command-role holders view, accept/reject, and
 * delete that subdivision's submitted applications or activity logs.
 * Per the department's decision, accept/reject only updates status
 * here — it does not DM the applicant.
 *
 * GET    ?div=slug&type=application|log[&status=pending|accepted|rejected] -> list
 * PATCH  { id, subdivisionSlug, status: "accepted"|"rejected" }             -> decide
 * DELETE ?id=..&div=slug                                                    -> remove
 *
 * Requires the D1 database bound as "DB".
 */
import { requireSession } from "../../_lib/auth-guard.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function parseSubmission(row) {
  return {
    id: row.id,
    subdivisionSlug: row.subdivision_slug,
    formType: row.form_type,
    discordId: row.discord_id,
    characterName: row.character_name,
    badgeNumber: row.badge_number,
    rank: row.rank,
    coreFields: JSON.parse(row.core_fields_json || "{}"),
    answers: JSON.parse(row.answers_json || "{}"),
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  if (!div || !["application", "log"].includes(type)) {
    return jsonResponse({ error: "div and type=application|log are required." }, 400);
  }
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  let query = "SELECT * FROM submissions WHERE subdivision_slug = ? AND form_type = ?";
  const params = [div, type];
  if (status && ["pending", "accepted", "rejected"].includes(status)) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY created_at DESC LIMIT 200";

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();
  return jsonResponse({ submissions: results.map(parseSubmission) }, 200);
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.subdivisionSlug || !["accepted", "rejected"].includes(body.status)) {
    return jsonResponse({ error: "id, subdivisionSlug, and status=accepted|rejected are required." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `UPDATE submissions SET status = ?, decided_by = ?, decided_at = datetime('now')
     WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(body.status, session.discordId, body.id, body.subdivisionSlug)
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

  await env.DB.prepare("DELETE FROM submissions WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  return jsonResponse({ ok: true }, 200);
}
