/**
 * Cloudflare Pages Function
 * GET /api/site-content
 *
 * Public, read-only: powers the homepage's Deputy of the Week, Deputy of
 * the Month, and Patrol Photos sections (see functions/api/admin/site-content.js
 * for the High-Command-only editor). Fails soft to empty defaults if the
 * database isn't set up yet or anything goes wrong — the homepage simply
 * hides those sections rather than breaking.
 */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const DEFAULTS = { deputy_of_week: {}, deputy_of_month: {}, patrol_photos: [] };

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return jsonResponse({ deputyOfWeek: {}, deputyOfMonth: {}, patrolPhotos: [] }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT content_key, value_json FROM site_content WHERE content_key IN ('deputy_of_week','deputy_of_month','patrol_photos')"
    ).all();
    const values = { ...DEFAULTS };
    for (const row of results || []) {
      try {
        values[row.content_key] = JSON.parse(row.value_json);
      } catch {
        // Keep the default for this key if it somehow isn't valid JSON.
      }
    }
    return jsonResponse(
      {
        deputyOfWeek: values.deputy_of_week || {},
        deputyOfMonth: values.deputy_of_month || {},
        patrolPhotos: values.patrol_photos || [],
      },
      200
    );
  } catch (err) {
    console.error("Failed to load site content (non-fatal):", err);
    return jsonResponse({ deputyOfWeek: {}, deputyOfMonth: {}, patrolPhotos: [] }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
