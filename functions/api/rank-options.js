/**
 * Cloudflare Pages Function
 * GET /api/rank-options?div=slug
 *
 * Public, read-only: returns the list of Rank options command staff have
 * configured for a subdivision (see functions/api/admin/rank-options.js),
 * in order. Used by:
 *   - log.html          - renders a dropdown instead of a free-text Rank
 *                          field once at least one option exists.
 *   - Command Access's Roster form (assets/command-access.js) - same
 *                          deal, a dropdown instead of free text.
 * The public Roster on each subdivision's Roster page is also sorted
 * using this same order (see functions/api/roster.js), so this list is
 * the single source of truth for "what order do ranks go in" everywhere.
 * (There used to be a public ranks.html hierarchy page too — it's been
 * removed; this list's only consumers now are the two dropdowns above
 * and the Roster sort.)
 *
 * Returns an empty list (never an error) if nothing's configured yet, if
 * the database isn't set up, or if anything goes wrong — every consumer
 * falls back gracefully whenever this list is empty, so nothing ever
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
