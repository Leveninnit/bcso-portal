/**
 * Cloudflare Pages Function
 * GET /api/sop
 *
 * Public, read-only: powers sop.html, the on-site Standard Operating
 * Procedure page (see functions/api/admin/sop.js for the
 * High-Command-only editor). Fails soft to an empty document if the
 * database isn't set up yet or anything goes wrong -- the page shows a
 * "not available" message rather than breaking.
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
  const { env } = context;
  if (!env.DB) return jsonResponse({ text: "", lastUpdated: null }, 200);
  try {
    const row = await env.DB.prepare("SELECT value_json FROM site_content WHERE content_key = 'sop'").first();
    let text = "";
    if (row) {
      try {
        text = JSON.parse(row.value_json).text || "";
      } catch {
        // Keep text empty if the stored value somehow isn't valid JSON.
      }
    }
    const lastUpdated = await getContentMeta(env, "sop");
    return jsonResponse({ text, lastUpdated }, 200);
  } catch (err) {
    console.error("Failed to load SOP (non-fatal):", err);
    return jsonResponse({ text: "", lastUpdated: null }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
