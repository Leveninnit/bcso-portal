/**
 * Cloudflare Pages Function
 * GET /api/leaderboard?div=slug|all&period=month|all
 *
 * Public, read-only (same visibility as /api/documents and the
 * Applications/Activity Log pages -- no login required): powers the
 * Leaderboards page.
 *
 * Aggregates activity-log submissions ('log' rows, NOT applications)
 * into two rankings -- total hours and activity count -- plus a capped
 * list of the individual log entries for the activity-log viewer.
 *
 * Counting rule: every submitted log counts EXCEPT rejected ones (so
 * pending + accepted both count). This gives command staff an escape
 * hatch -- rejecting a bogus/test entry removes it from the board --
 * without requiring every real log to be manually accepted first.
 *
 * div=all (or omitted) aggregates across every subdivision (the
 * "Global" board). div=<slug> scopes everything to one subdivision.
 * period=all (default) is all-time; period=month is the current
 * calendar month only (server clock, UTC, matching D1's datetime('now')).
 *
 * People are grouped by discord_id, not badge number -- a badge typo or
 * a mid-career badge change would otherwise split one deputy into two
 * separate leaderboard rows. discord_id itself is never included in the
 * response -- badge number and character name (both from that person's
 * most recent log) are enough to identify someone on a public board
 * without publishing their Discord account.
 *
 * Individual log entries omit the shift summary text -- the board shows
 * who logged what hours and when, not the private details of the shift.
 *
 * Fails soft (empty leaderboard/log) if the database isn't set up yet
 * or anything goes wrong -- the page still renders, it just shows no
 * data.
 */

const SLUG_RE = /^[a-z0-9_-]{1,30}$/;
const LOG_LIMIT = 200;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function emptyPayload() {
  return { leaderboard: { byHours: [], byCount: [] }, log: [] };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const divParam = (url.searchParams.get("div") || "all").toLowerCase();
  const div = divParam !== "all" && SLUG_RE.test(divParam) ? divParam : null;

  const period = url.searchParams.get("period") === "month" ? "month" : "all";

  if (!env.DB) {
    return jsonResponse(emptyPayload(), 200);
  }

  try {
    let query =
      "SELECT discord_id, subdivision_slug, character_name, badge_number, core_fields_json, created_at " +
      "FROM submissions WHERE form_type = 'log' AND status != 'rejected'";
    const binds = [];
    if (div) {
      query += " AND subdivision_slug = ?";
      binds.push(div);
    }
    if (period === "month") {
      query += " AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now')";
    }
    query += " ORDER BY created_at DESC";

    const { results } = await env.DB.prepare(query)
      .bind(...binds)
      .all();
    const rows = results || [];

    // --- Aggregate into per-person totals, keyed by Discord ID ----------
    // Rows arrive newest-first, so the first row seen for a given person
    // is their most recent log -- that's the one whose character name /
    // badge / subdivision we display for them.
    const byPerson = new Map();
    const logEntries = [];
    for (const row of rows) {
      let core = {};
      try {
        core = JSON.parse(row.core_fields_json || "{}");
      } catch {
        core = {};
      }
      const hours = Number(core.hoursOnDuty);
      const validHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
      const personKey = row.discord_id || row.badge_number || row.character_name || "unknown";

      if (!byPerson.has(personKey)) {
        byPerson.set(personKey, {
          characterName: row.character_name,
          badgeNumber: row.badge_number,
          subdivisionSlug: row.subdivision_slug,
          hours: 0,
          count: 0,
        });
      }
      const entry = byPerson.get(personKey);
      entry.hours += validHours;
      entry.count += 1;

      if (logEntries.length < LOG_LIMIT) {
        logEntries.push({
          characterName: row.character_name,
          badgeNumber: row.badge_number,
          subdivisionSlug: row.subdivision_slug,
          hours: validHours,
          createdAt: row.created_at,
        });
      }
    }

    const people = Array.from(byPerson.values()).map((p) => ({
      ...p,
      hours: Math.round(p.hours * 100) / 100,
    }));

    const byHours = [...people]
      .sort((a, b) => b.hours - a.hours || b.count - a.count)
      .map((p, i) => ({ rank: i + 1, ...p }));
    const byCount = [...people]
      .sort((a, b) => b.count - a.count || b.hours - a.hours)
      .map((p, i) => ({ rank: i + 1, ...p }));

    return jsonResponse({ leaderboard: { byHours, byCount }, log: logEntries }, 200);
  } catch (err) {
    console.error("Failed to build leaderboard (non-fatal):", err);
    return jsonResponse(emptyPayload(), 200);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
