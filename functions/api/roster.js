/**
 * Cloudflare Pages Function
 * GET /api/roster?div=slug
 *
 * Public, read-only: powers the Roster section on each subdivision's
 * Documents page (documents.html?div=slug). Every subdivision has one,
 * including SRT.
 *
 * Command staff only enter a Rank + Badge Number (+ optional Notes) per
 * entry, from Command Access -> that subdivision -> Roster (see
 * functions/api/admin/roster.js). Character Name, Discord ID, and
 * Department Status are never stored — this endpoint resolves them live
 * from the Master Roster Google Sheet by badge number every time the
 * roster is loaded (see functions/_lib/roster-sheet.js), so a name or
 * status change there shows up on the portal immediately with nothing
 * to keep in sync by hand.
 *
 * Hours / Activations / Activity are never stored either — they're
 * computed live from that subdivision's Activity Log submissions
 * ('log' rows in the submissions table, same source as
 * functions/api/leaderboard.js), matched to a roster entry by badge
 * number:
 *   - hoursLogged / activations: all-time totals (every non-rejected
 *     log counts, mirroring the leaderboard's counting rule).
 *   - activityLevel: "Active" / "Semi-Active" / "Inactive", based only
 *     on THIS CALENDAR MONTH's hours/activations, so it reflects how
 *     active someone is right now rather than their career total.
 *     Thresholds (see activityLevelFor below): 3+ hours or 3+
 *     activations this month = Active, any activity at all =
 *     Semi-Active, none = Inactive. This is separate from and doesn't
 *     read from Department Status.
 *
 * Fails soft: an entry whose badge number isn't found on the Master
 * Roster (not yet added there, typo, etc.) is still returned with
 * whatever was entered, just with an empty name/discordId/status — the
 * roster always renders, it just can't fill in what it doesn't have.
 * Same for Hours/Activations/Activity if the Activity Log lookup fails
 * — they fall back to 0/0/Inactive rather than breaking the page.
 *
 * Sort order: if the subdivision has a Rank list configured (Command
 * Access -> that subdivision -> Ranks, also shown on ranks.html), the
 * roster is sorted by that rank hierarchy — highest rank first — with
 * each roster entry's own manual up/down order used only as a
 * tiebreaker within the same rank. If no rank list is configured (or a
 * roster entry's rank doesn't match one of the configured options), it
 * falls back to the roster's own manual order, exactly as before.
 */
import { fetchRosterTable, lookupByBadge } from "../_lib/roster-sheet.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function normalizeRankLabel(value) {
  return (value || "").toString().trim().toLowerCase();
}
function hoursFromCore(core) {
  const hours = Number.isFinite(Number(core.durationSeconds))
    ? Number(core.durationSeconds) / 3600
    : Number(core.hoursOnDuty);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}
function activityLevelFor(hours, count) {
  if (hours >= 3 || count >= 3) return "Active";
  if (hours > 0 || count > 0) return "Semi-Active";
  return "Inactive";
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
      "SELECT rank, badge_number, notes FROM roster_entries WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(div)
      .all();
    const rows = results || [];
    if (!rows.length) return jsonResponse({ entries: [] }, 200);

    let rankPosition = null;
    try {
      const { results: rankRows } = await env.DB.prepare(
        "SELECT label FROM rank_options WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
      )
        .bind(div)
        .all();
      if (rankRows && rankRows.length) {
        rankPosition = new Map();
        rankRows.forEach((r, i) => {
          const key = normalizeRankLabel(r.label);
          if (!rankPosition.has(key)) rankPosition.set(key, i);
        });
      }
    } catch (err) {
      console.error("Failed to load rank order (non-fatal, falls back to manual order):", err);
    }
    if (rankPosition) {
      rows.sort((a, b) => {
        const posA = rankPosition.has(normalizeRankLabel(a.rank)) ? rankPosition.get(normalizeRankLabel(a.rank)) : Infinity;
        const posB = rankPosition.has(normalizeRankLabel(b.rank)) ? rankPosition.get(normalizeRankLabel(b.rank)) : Infinity;
        return posA - posB;
      });
    }

    // Activity Log totals, keyed by badge number, scoped to this
    // subdivision. allTime feeds the Hours/Activations columns; thisMonth
    // (current UTC calendar month, matching D1's own clock) feeds the
    // Activity pill. Non-fatal: an error here just leaves every entry at
    // 0/0/Inactive instead of breaking the roster.
    const allTime = new Map();
    const thisMonth = new Map();
    try {
      const { results: logRows } = await env.DB.prepare(
        "SELECT badge_number, core_fields_json, created_at FROM submissions WHERE subdivision_slug = ? AND form_type = 'log' AND status != 'rejected'"
      )
        .bind(div)
        .all();
      const currentYm = new Date().toISOString().slice(0, 7);
      for (const row of logRows || []) {
        const badge = (row.badge_number || "").trim();
        if (!badge) continue;
        let core = {};
        try {
          core = JSON.parse(row.core_fields_json || "{}");
        } catch {
          core = {};
        }
        const hours = hoursFromCore(core);

        if (!allTime.has(badge)) allTime.set(badge, { hours: 0, count: 0 });
        const t = allTime.get(badge);
        t.hours += hours;
        t.count += 1;

        if ((row.created_at || "").slice(0, 7) === currentYm) {
          if (!thisMonth.has(badge)) thisMonth.set(badge, { hours: 0, count: 0 });
          const m = thisMonth.get(badge);
          m.hours += hours;
          m.count += 1;
        }
      }
    } catch (err) {
      console.error("Failed to load Activity Log totals (non-fatal):", err);
    }

    const table = await fetchRosterTable(env);
    const entries = rows.map((r) => {
      const person = table ? lookupByBadge(table, r.badge_number) : { found: false };
      const badge = (r.badge_number || "").trim();
      const totals = allTime.get(badge) || { hours: 0, count: 0 };
      const monthTotals = thisMonth.get(badge) || { hours: 0, count: 0 };
      return {
        rank: r.rank,
        badgeNumber: r.badge_number,
        notes: r.notes,
        characterName: person.found ? person.name : "",
        discordId: person.found ? person.discordId : "",
        departmentStatus: person.found ? person.departmentStatus : "",
        hoursLogged: Math.round(totals.hours * 10) / 10,
        activations: totals.count,
        activityLevel: activityLevelFor(monthTotals.hours, monthTotals.count),
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
