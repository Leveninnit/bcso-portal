/**
 * Cloudflare Pages Function
 * /api/admin/questions
 *
 * Lets a subdivision's command-role holders manage the custom extra
 * questions shown on that subdivision's application or activity log
 * form (beyond the fixed Discord ID / Character Name / Badge / Rank
 * fields, which always stay put so roster auto-fill keeps working).
 *
 * GET    ?div=slug&type=application|log        -> list questions
 * POST   { subdivisionSlug, formType, label, questionType, options, required, sortOrder } -> create
 * PUT    { id, subdivisionSlug, label, questionType, options, required, sortOrder }        -> update
 * DELETE ?id=..&div=slug                        -> remove
 *
 * Every write requires a valid Command Access session for that exact
 * subdivision — someone with only the RTD command role cannot touch
 * TEU's questions, for example.
 *
 * Requires the D1 database bound as "DB" (Settings → Functions → D1
 * database bindings in the Cloudflare Pages dashboard).
 */
import { requireSession } from "../../_lib/auth-guard.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function parseQuestion(row) {
  return {
    id: row.id,
    subdivisionSlug: row.subdivision_slug,
    formType: row.form_type,
    label: row.label,
    questionType: row.question_type,
    options: row.options_json ? JSON.parse(row.options_json) : [],
    required: !!row.required,
    sortOrder: row.sort_order,
  };
}
function validQuestionShape(body) {
  return (
    body &&
    typeof body.label === "string" &&
    body.label.trim() &&
    ["text", "paragraph", "dropdown"].includes(body.questionType) &&
    (body.questionType !== "dropdown" ||
      (Array.isArray(body.options) && body.options.length > 0))
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  const type = url.searchParams.get("type");
  if (!div || !["application", "log"].includes(type)) {
    return jsonResponse({ error: "div and type=application|log are required." }, 400);
  }
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT * FROM questions WHERE subdivision_slug = ? AND form_type = ? ORDER BY sort_order ASC, id ASC"
  )
    .bind(div, type)
    .all();
  return jsonResponse({ questions: results.map(parseQuestion) }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.subdivisionSlug || !["application", "log"].includes(body.formType) || !validQuestionShape(body)) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `INSERT INTO questions (subdivision_slug, form_type, label, question_type, options_json, required, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.subdivisionSlug,
      body.formType,
      body.label.trim().slice(0, 200),
      body.questionType,
      body.questionType === "dropdown" ? JSON.stringify(body.options.map((o) => String(o).slice(0, 100))) : null,
      body.required === false ? 0 : 1,
      Number.isFinite(body.sortOrder) ? body.sortOrder : 0
    )
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.subdivisionSlug || !validQuestionShape(body)) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `UPDATE questions
     SET label = ?, question_type = ?, options_json = ?, required = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND subdivision_slug = ?`
  )
    .bind(
      body.label.trim().slice(0, 200),
      body.questionType,
      body.questionType === "dropdown" ? JSON.stringify(body.options.map((o) => String(o).slice(0, 100))) : null,
      body.required === false ? 0 : 1,
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

  await env.DB.prepare("DELETE FROM questions WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  return jsonResponse({ ok: true }, 200);
}
