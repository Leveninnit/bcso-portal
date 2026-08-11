/**
 * Cloudflare Pages Function
 * GET /api/leaderboard?div=slug|all&period=month|all
 *
 * Public, read-only (same visibility as /api/documents and the
 * Applications/Activity Log pages -- no login required): powers the
 * Leaderboards page.
 *
 * Aggregates activity-log submissions ('log' rows, NOT applications)
 * into two individual rankings -- total hours and activity count -- a
 * subdivision-level ranking (same two metrics, totalled per subdivision
 * instead of per person), plus a capped list of the individual log
 * entries for the activity-log viewer.
 *
 * Counting rule: every submitted log counts EXCEPT rejected ones (so
 * pending + accepted both count). This gives command staff an escape
 * hatch -- rejecting a bogus/test entry removes it from the board --
 * without requiring every real log to be manually accepted first.
 *
 * div=all (or omitted) aggregates across every subdivision (the
 * "Global" board). div=<slug> scopes everything to one subdivision --
 * the subdivision ranking is only meaningful on the Global view, so the
 * frontend hides it when a single subdivision is selected.
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
// D1's own clock (and created_at, via datetime('now')) is UTC. Filtering
// "this month" purely server-side with strftime('%Y-%m', 'now') means
// the boundary is always UTC midnight on the 1st -- for anyone west of
// UTC, their local "start of the month" is still the tail end of last
// month by that clock (e.g. 11pm Aug 31 Pacific is already Sep 1 UTC),
// so a log made in the first few hours of a new local month could get
// counted in the wrong one, or a log from the last local hours of a
// month could get left out of it. DATETIME_RE validates an optional
// client-supplied LOCAL month boundary (converted to its UTC equivalent
// client-side -- see assets/leaderboards.js) so "This Month" can mean
// the viewer's own calendar month instead of always UTC's.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
// A calendar month is never more than 31 days -- this caps how wide a
// monthStart/monthEnd span this endpoint will honor. Without it,
// DATETIME_RE only validates the *format* of the two params, so a crafted
// link could pass a monthStart/monthEnd pair spanning years (still
// labeled "This Month" by the caller) and pull far more data than the
// "this month" scoping is meant to allow, or pass monthEnd <= monthStart
// for a query that silently matches nothing.
const MAX_MONTH_SPAN_MS = 32 * 24 * 60 * 60 * 1000;

function isReasonableMonthRange(startParam, endParam) {
  const start = Date.parse(startParam.replace(" ", "T") + "Z");
  const end = Date.parse(endParam.replace(" ", "T") + "Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end <= start) return false;
  return end - start <= MAX_MONTH_SPAN_MS;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    // See functions/api/team.js for why this is a short public cache
    // instead of no-store.
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
  });
}

function emptyPayload() {
  return {
    leaderboard: { byHours: [], byCount: [] },
    subdivisions: { byHours: [], byCount: [] },
    log: [],
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const divParam = (url.searchParams.get("div") || "all").toLowerCase();
  const div = divParam !== "all" && SLUG_RE.test(divParam) ? divParam : null;

  const period = url.searchParams.get("period") === "month" ? "month" : "all";
  const monthStartParam = url.searchParams.get("monthStart") || "";
  const monthEndParam = url.searchParams.get("monthEnd") || "";
  const hasLocalMonthBounds =
    DATETIME_RE.test(monthStartParam) &&
    DATETIME_RE.test(monthEndParam) &&
    isReasonableMonthRange(monthStartParam, monthEndParam);

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
      if (hasLocalMonthBounds) {
        // Viewer's own local calendar month, converted to its UTC
        // equivalent client-side -- see DATETIME_RE's comment above.
        query += " AND created_at >= ? AND created_at < ?";
        binds.push(monthStartParam, monthEndParam);
      } else {
        // No (valid) client-supplied bounds -- fall back to the old
        // UTC-calendar-month behavior so this endpoint still works for
        // any caller that doesn't pass them.
        query += " AND substr(created_at, 1, 7) = strftime('%Y-%m', 'now')";
      }
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
    // --- Aggregate into per-subdivision totals in the same pass ---------
    const bySubdivision = new Map();
    const logEntries = [];

    for (const row of rows) {
      let core = {};
      try {
        core = JSON.parse(row.core_fields_json || "{}");
      } catch {
        core = {};
      }
      // Newer submissions store an exact durationSeconds (see
      // functions/api/log.js); older ones only have a decimal hoursOnDuty.
      // Support both so the leaderboard keeps working across the change.
      const hours = Number.isFinite(Number(core.durationSeconds))
        ? Number(core.durationSeconds) / 3600
        : Number(core.hoursOnDuty);
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

      const subKey = row.subdivision_slug || "unknown";
      if (!bySubdivision.has(subKey)) {
        bySubdivision.set(subKey, { subdivisionSlug: subKey, hours: 0, count: 0 });
      }
      const subEntry = bySubdivision.get(subKey);
      subEntry.hours += validHours;
      subEntry.count += 1;

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

    const subs = Array.from(bySubdivision.values()).map((s) => ({
      ...s,
      hours: Math.round(s.hours * 100) / 100,
    }));
    const subByHours = [...subs]
      .sort((a, b) => b.hours - a.hours || b.count - a.count)
      .map((s, i) => ({ rank: i + 1, ...s }));
    const subByCount = [...subs]
      .sort((a, b) => b.count - a.count || b.hours - a.hours)
      .map((s, i) => ({ rank: i + 1, ...s }));

    return jsonResponse(
      {
        leaderboard: { byHours, byCount },
        subdivisions: { byHours: subByHours, byCount: subByCount },
        log: logEntries,
      },
      200
    );
  } catch (err) {
    console.error("Failed to build leaderboard (non-fatal):", err);
    return jsonResponse(emptyPayload(), 200);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
