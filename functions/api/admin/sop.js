/**
 * Cloudflare Pages Function
 * GET/PUT /api/admin/sop
 *
 * High-Command-only editor for the on-site Standard Operating Procedure
 * text (sop.html) -- gated the same way as /api/admin/site-content and
 * /api/admin/team (the isHighCommand flag set on the session at login).
 *
 * This replaces linking out to a separate Google Doc for the SOP: the
 * full text lives in the database and is edited right here, so command
 * staff can paste in updated wording and it's live immediately, with no
 * separate document to keep shared/up to date.
 *
 * Stored as a single row in the existing site_content table
 * (content_key = "sop", value_json = {"text": "..."}) -- no schema
 * change needed for that part. Every save also records who made it and
 * when in content_meta (content_key "sop"), which is what powers the
 * "Last updated ... by ..." line shown on sop.html (see
 * functions/api/sop.js, the public read-only counterpart, and
 * functions/_lib/content-meta.js).
 *
 * GET returns { text, lastUpdated }. PUT { text } replaces the whole
 * document (this is a single text field, not a rich editor -- command
 * staff are expected to paste the whole SOP in and save).
 */
import { requireSession } from "../../_lib/auth-guard.js";
import { touchContentMeta, getContentMeta } from "../../_lib/content-meta.js";

const MAX_SOP_LEN = 100000;

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
  if (!env.DB) return jsonResponse({ text: "", lastUpdated: null }, 200);

  try {
    const row = await env.DB.prepare("SELECT value_json FROM site_content WHERE content_key = 'sop'").first();
    let text = "";
    if (row) {
      try {
        text = JSON.parse(row.value_json).text || "";
      } catch {
        /* ignore malformed row */
      }
    }
    const lastUpdated = await getContentMeta(env, "sop");
    return jsonResponse({ text, lastUpdated }, 200);
  } catch (err) {
    console.error("Failed to load SOP:", err);
    return jsonResponse({ error: "Failed to load. Try again." }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const access = await checkAccess(request, env);
  if (!access.ok) return accessDeniedResponse(access.status);
  if (!env.DB) return jsonResponse({ error: "Database not configured." }, 500);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return jsonResponse({ error: "text is required." }, 400);
  }
  if (body.text.length > MAX_SOP_LEN) {
    return jsonResponse({ error: `SOP text must be ${MAX_SOP_LEN.toLocaleString()} characters or fewer.` }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO site_content (content_key, value_json, updated_at) VALUES ('sop', ?, datetime('now'))
       ON CONFLICT(content_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
      .bind(JSON.stringify({ text: body.text }))
      .run();
    await touchContentMeta(env, "sop", access.session.username || access.session.discordId);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Failed to save SOP:", err);
    return jsonResponse({ error: "Failed to save. Try again." }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET or PUT." }, 405);
}
