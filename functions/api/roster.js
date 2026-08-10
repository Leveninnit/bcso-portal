/**
 * Cloudflare Pages Function
 * GET /api/roster?div=slug
 *
 * Public, read-only: powers the Roster section on each subdivision's
 * Documents page (documents.html?div=slug). Every subdivision has one,
 * including SRT.
 *
 * Command staff only enter a Rank + Badge Number (+ optional Callsign /
 * Notes) per entry, from Command Access -> that subdivision -> Roster
 * (see functions/api/admin/roster.js). Character Name and Discord ID
 * are never stored — this endpoint resolves them live from the Master
 * Roster Google Sheet by badge number every time the roster is loaded
 * (see functions/_lib/roster-sheet.js), so a name change there shows up
 * on the portal immediately with nothing to keep in sync by hand.
 *
 * Fails soft: an entry whose badge number isn't found on the Master
 * Roster (not yet added there, typo, etc.) is still returned with
 * whatever was entered, just with an empty name/discordId — the roster
 * always renders, it just can't fill in a name it doesn't have.
 */
import { fetchRosterTable, lookupByBadge } from "../_lib/roster-sheet.js";

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
    return jsonResponse({ entries: [] }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT rank, badge_number, callsign, notes FROM roster_entries WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(div)
      .all();
    const rows = results || [];
    if (!rows.length) return jsonResponse({ entries: [] }, 200);

    const table = await fetchRosterTable(env);
    const entries = rows.map((r) => {
      const person = table ? lookupByBadge(table, r.badge_number) : { found: false };
      return {
        rank: r.rank,
        badgeNumber: r.badge_number,
        callsign: r.callsign,
        notes: r.notes,
        characterName: person.found ? person.name : "",
        discordId: person.found ? person.discordId : "",
      };
    });
    return jsonResponse({ entries }, 200);
  } catch (err) {
    console.error("Failed to load roster (non-fatal):", err);
    return jsonResponse({ entries: [] }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
