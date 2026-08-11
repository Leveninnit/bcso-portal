/**
 * Cloudflare Pages Function
 * GET /api/subdivision-sop?div=slug
 *
 * Public, read-only: powers subdivision-sop.html?div=slug, a
 * subdivision's own Standard Operating Procedure page (see
 * functions/api/admin/subdivision-sop.js for the editor, restricted to
 * that subdivision's own command staff). Separate from the
 * department-wide SOP (functions/api/sop.js / sop.html).
 *
 * Fails soft to an empty document if div is missing, the database isn't
 * set up yet, or anything goes wrong -- the page shows a "not available"
 * message rather than breaking.
 *
 * Returns { text, lastUpdated: { by, at } | null }.
 */
import { getContentMeta } from "../_lib/content-meta.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    // See functions/api/team.js for why this is a short public cache
    // instead of no-store.
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div || !env.DB) return jsonResponse({ text: "", lastUpdated: null }, 200);
  try {
    const row = await env.DB.prepare("SELECT value_json FROM site_content WHERE content_key = ?")
      .bind(`sop:${div}`)
      .first();
    let text = "";
    if (row) {
      try {
        text = JSON.parse(row.value_json).text || "";
      } catch {
        // Keep text empty if the stored value somehow isn't valid JSON.
      }
    }
    const lastUpdated = await getContentMeta(env, `sop:${div}`);
    return jsonResponse({ text, lastUpdated }, 200);
  } catch (err) {
    console.error("Failed to load subdivision SOP (non-fatal):", err);
    return jsonResponse({ text: "", lastUpdated: null }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
