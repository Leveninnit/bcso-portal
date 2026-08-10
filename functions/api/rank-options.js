/**
 * Cloudflare Pages Function
 * GET /api/rank-options?div=slug
 *
 * Public, read-only: returns the list of Rank options command staff have
 * configured for a subdivision's Activity Log form (see
 * functions/api/admin/rank-options.js), so log.html can render a
 * dropdown instead of a free-text Rank field. Returns an empty list
 * (never an error) if nothing's configured yet, if the database isn't
 * set up, or if anything goes wrong — log.html falls back to the
 * original free-text field whenever this list is empty, so nothing ever
 * breaks for a subdivision that hasn't set this up.
 */
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
  if (!div || !env.DB) {
    return jsonResponse({ options: [] }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, label FROM rank_options WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(div)
      .all();
    return jsonResponse({ options: (results || []).map((r) => r.label) }, 200);
  } catch {
    return jsonResponse({ options: [] }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
