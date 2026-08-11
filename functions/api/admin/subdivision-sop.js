/**
 * Cloudflare Pages Function
 * GET/PUT /api/admin/subdivision-sop?div=slug
 *
 * Lets a subdivision's own command-role holders manage that
 * subdivision's Standard Operating Procedure text -- shown publicly on
 * subdivision-sop.html?div=slug, linked from that subdivision's
 * Documents page. Every subdivision has one, including SRT.
 *
 * This is separate from the department-wide SOP (sop.html /
 * sop-admin.html / functions/api/admin/sop.js), which is
 * High-Command-only and covers the full department. This one is scoped
 * to and editable entirely by the subdivision itself -- same access
 * level as its Roster/Ranks/Documents (requireSession with a
 * subdivision slug), not High Command.
 *
 * Stored as a single row in the existing site_content table
 * (content_key = "sop:<slug>", value_json = {"text": "..."}) -- the same
 * table the department-wide SOP and homepage content use, just under a
 * different key, so no schema change is needed. Every save also records
 * who made it and when in content_meta (content_key "sop:<slug>"), which
 * is what powers the "Last updated ... by ..." line shown on
 * subdivision-sop.html and in this panel (see functions/api/
 * subdivision-sop.js, the public read-only counterpart, and
 * functions/_lib/content-meta.js).
 *
 * GET returns { text, lastUpdated }. PUT { subdivisionSlug, text }
 * replaces the whole document.
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

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ text: "", lastUpdated: null }, 200);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div) return jsonResponse({ error: "div is required." }, 400);
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  try {
    const row = await env.DB.prepare("SELECT value_json FROM site_content WHERE content_key = ?")
      .bind(`sop:${div}`)
      .first();
    let text = "";
    if (row) {
      try {
        text = JSON.parse(row.value_json).text || "";
      } catch {
        /* ignore malformed row */
      }
    }
    const lastUpdated = await getContentMeta(env, `sop:${div}`);
    return jsonResponse({ text, lastUpdated }, 200);
  } catch (err) {
    console.error("Failed to load subdivision SOP:", err);
    return jsonResponse({ error: "Failed to load. Try again." }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured." }, 500);

  const body = await request.json().catch(() => null);
  if (!body || !body.subdivisionSlug || typeof body.text !== "string") {
    return jsonResponse({ error: "subdivisionSlug and text are required." }, 400);
  }
  if (body.text.length > MAX_SOP_LEN) {
    return jsonResponse({ error: `SOP text must be ${MAX_SOP_LEN.toLocaleString()} characters or fewer.` }, 400);
  }
  const session = await requireSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  try {
    await env.DB.prepare(
      `INSERT INTO site_content (content_key, value_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(content_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
      .bind(`sop:${body.subdivisionSlug}`, JSON.stringify({ text: body.text }))
      .run();
    await touchContentMeta(env, `sop:${body.subdivisionSlug}`, session.username || session.discordId);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Failed to save subdivision SOP:", err);
    return jsonResponse({ error: "Failed to save. Try again." }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET or PUT." }, 405);
}
