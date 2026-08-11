/**
 * Cloudflare Pages Function
 * GET /api/team
 *
 * Public, read-only (same visibility as /api/documents and the
 * Applications/Activity Log/Leaderboards pages -- no login required):
 * powers the public "Meet the Team" page. Returns the 5 High Command
 * roster slots, in slot order. Fails soft (empty roster) if the
 * database isn't set up yet or anything goes wrong -- the page still
 * renders, it just shows every slot as vacant.
 */

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    // Public, read-mostly, not session-bound -- short edge cache instead
    // of no-store so a burst of visitors doesn't each force a fresh DB
    // round-trip. 15s is short enough that a High Command edit shows up
    // for everyone within moments.
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return jsonResponse({ roster: [] }, 200);
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT slot_number, character_name, rank_title, subdivision_slug, bio, photo_url " +
        "FROM team_roster ORDER BY slot_number"
    ).all();
    return jsonResponse({ roster: results || [] }, 200);
  } catch (err) {
    console.error("Failed to load team roster (non-fatal):", err);
    return jsonResponse({ roster: [] }, 200);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
