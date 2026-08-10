/**
 * Cloudflare Pages Function
 * GET /api/leadership?div=slug
 *
 * Public, read-only: powers the "Command Staff" panel shown on each
 * subdivision's Apply page (e.g. OCD-01/02/03) — same idea as
 * /api/team's department-wide High Command roster, but scoped to one
 * subdivision. SRT is intentionally never returned here (no public
 * applications, high sensitivity) — see functions/api/admin/leadership.js
 * for the full explanation. Fails soft (empty list) if the database
 * isn't set up yet or anything goes wrong.
 */
const MAX_SLOTS = { teu: 3, ocd: 3, rtd: 3, nred: 1 };

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div || !MAX_SLOTS[div] || !env.DB) {
    return jsonResponse({ leadership: [] }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT slot_number, character_name, rank_title, bio, photo_url " +
        "FROM subdivision_leadership WHERE subdivision_slug = ? ORDER BY slot_number"
    )
      .bind(div)
      .all();
    return jsonResponse({ leadership: results || [] }, 200);
  } catch (err) {
    console.error("Failed to load subdivision leadership (non-fatal):", err);
    return jsonResponse({ leadership: [] }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
