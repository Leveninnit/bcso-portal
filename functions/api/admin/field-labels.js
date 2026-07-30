/**
 * Cloudflare Pages Function
 * /api/admin/field-labels
 *
 * Lets a subdivision's command-role holders reword the "original"
 * fixed fields on that subdivision's application or activity log form
 * — Character Name, Discord ID, Badge Number, Rank, and the
 * form-specific content questions (e.g. "Why do you want to join?" /
 * "Relevant experience" for applications, "Hours on Duty" / "Shift
 * Summary" for logs). This only changes the label text shown to
 * applicants; the underlying field name, input type, and validation
 * stay the same so roster auto-fill and submission storage keep
 * working exactly as before.
 *
 * GET    ?div=slug&type=application|log                        -> current overrides (only overridden fields)
 * PUT    { subdivisionSlug, formType, fieldKey, label }         -> set/update an override
 * DELETE ?div=slug&type=application|log&field=fieldKey          -> remove an override (reset to default)
 *
 * Every write requires a valid Command Access session for that exact
 * subdivision, same as the custom-questions customizer.
 *
 * Requires the D1 database bound as "DB" (Settings → Functions → D1
 * database bindings in the Cloudflare Pages dashboard).
 */
import { requireSession } from "../../_lib/auth-guard.js";

const VALID_FIELD_KEYS = {
  application: ["characterName", "discordId", "badgeNumber", "rank", "whyJoin", "experience"],
  log: ["characterName", "discordId", "badgeNumber", "rank", "hoursOnDuty", "summary"],
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
    "SELECT field_key, label FROM field_labels WHERE subdivision_slug = ? AND form_type = ?"
  )
    .bind(div, type)
    .all();
  const labels = {};
  (results || []).forEach((row) => (labels[row.field_key] = row.label));
  return jsonResponse({ labels }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !body.subdivisionSlug ||
    !["application", "log"].includes(body.formType) ||
    !VALID_FIELD_KEYS[body.formType].includes(body.fieldKey) ||
    typeof body.label !== "string" ||
    !body.label.trim()
  ) {
    return jsonResponse({ error: "Missing or invalid fields." }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    `INSERT INTO field_labels (subdivision_slug, form_type, field_key, label, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(subdivision_slug, form_type, field_key)
     DO UPDATE SET label = excluded.label, updated_at = datetime('now')`
  )
    .bind(body.subdivisionSlug, body.formType, body.fieldKey, body.label.trim().slice(0, 200))
    .run();

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  const type = url.searchParams.get("type");
  const field = url.searchParams.get("field");
  if (!div || !["application", "log"].includes(type) || !field) {
    return jsonResponse({ error: "div, type=application|log, and field are required." }, 400);
  }
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  await env.DB.prepare(
    "DELETE FROM field_labels WHERE subdivision_slug = ? AND form_type = ? AND field_key = ?"
  )
    .bind(div, type, field)
    .run();
  return jsonResponse({ ok: true }, 200);
}
