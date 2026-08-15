/**
 * Cloudflare Pages Function
 * GET /api/admin/cadet-residency?div=slug
 *
 * "Cadet Residency" -- Command Access -> RTD -> Cadet Residency. Lists
 * every row on the Master Roster Google Sheet's "Cadet Roster" tab
 * (NOT this subdivision's own D1-backed Roster -- see
 * functions/api/admin/roster.js, which is a separate, unrelated list)
 * currently ranked "Cadet" (case-insensitive, trimmed match -- same
 * convention used for rank matching elsewhere in this codebase), how
 * many days they've held that rank, and flags anyone at or over BCSO's
 * 14-day cadet residency limit as needing to be removed.
 *
 * "How long they've held that rank" is read directly from the sheet's
 * own "Days in Position" column (command staff maintain it there) --
 * no date math or D1 tracking needed on this end.
 *
 * Discord ID isn't a column on the Cadet Roster tab, so it's resolved
 * live from the Employee Database tab by Badge Number, same as the
 * public Roster (functions/api/roster.js).
 *
 * This is display-only -- there's no write access to the Google Sheet
 * from this codebase, so there's no Remove action here. Command staff
 * remove an overstayed cadet by editing the sheet directly; this panel
 * just flags who needs it and lets them copy the Discord ID to follow
 * up.
 *
 * Gated the same way as every other Command Access panel: requires a
 * valid session for this exact subdivision
 * (functions/_lib/auth-guard.js). The UI only shows this tab for RTD
 * (Recruitment & Training is the subdivision that actually manages
 * cadets), but this endpoint isn't hardcoded to that slug.
 */
import { requireSession } from "../../_lib/auth-guard.js";
import { fetchCadetRosterTable, cadetFromRow, fetchRosterTable, lookupByBadge } from "../../_lib/roster-sheet.js";

const CADET_RESIDENCY_LIMIT_DAYS = 14;
const CADET_RANK_LABEL = "cadet";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizeRankLabel(value) {
  return (value || "").toString().trim().toLowerCase();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div) return jsonResponse({ error: "div is required." }, 400);
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const cadetTable = await fetchCadetRosterTable(env, { debug: true });
  if (!cadetTable || !cadetTable.rows) {
    return jsonResponse(
      {
        error: "Couldn't read the Cadet Roster sheet right now. Make sure GOOGLE_SHEETS_API_KEY and ROSTER_SHEET_ID are configured.",
        debug: cadetTable
          ? { message: cadetTable.debug, gid: cadetTable.gid, sheetId: cadetTable.sheetId, allTabs: cadetTable.allTabs }
          : "fetchCadetRosterTable returned null",
      },
      502
    );
  }

  const cadets = cadetTable.rows
    .slice(1)
    .map((row) => cadetFromRow(cadetTable, row))
    // Skip empty placeholder rows (no badge and no name -- e.g. unused
    // CADET-## slots reserved for future use). The Rank check is
    // deliberately lenient -- a blank Rank cell still counts as a
    // cadet (this whole tab is dedicated to cadets, so command staff
    // may not bother filling in a per-row Rank at all), and a filled
    // cell only has to *contain* "cadet" rather than match it exactly,
    // so values like "Cadet I" or "RTD Cadet" still count. A row is
    // only excluded here if Rank is explicitly filled in with
    // something else entirely (e.g. someone already promoted out but
    // not yet removed from the tab).
    .filter((c) => {
      if (!c.badgeNumber && !c.name) return false;
      const rank = normalizeRankLabel(c.rank);
      return !rank || rank.includes(CADET_RANK_LABEL);
    });

  if (!cadets.length) {
    return jsonResponse(
      {
        entries: [],
        limitDays: CADET_RESIDENCY_LIMIT_DAYS,
        debug: {
          resolvedTabName: cadetTable.resolvedTabName,
          gid: cadetTable.gid,
          rawRowCount: cadetTable.rows.length,
          headerIdx: cadetTable.headerIdx,
          header: cadetTable.header,
          columnsFound: {
            callsign: cadetTable.idxCallsign,
            badge: cadetTable.idxBadge,
            name: cadetTable.idxName,
            rank: cadetTable.idxRank,
            hireDate: cadetTable.idxHireDate,
            days: cadetTable.idxDays,
          },
        },
      },
      200
    );
  }

  // Discord ID isn't on the Cadet Roster tab -- resolved live from the
  // Employee Database tab by badge number, same as the public roster.
  // Fails soft: if the sheet can't be reached, entries still render
  // with a blank Discord ID rather than the whole panel breaking.
  const employeeTable = await fetchRosterTable(env);
  const entries = cadets
    .map((c) => {
      const person = employeeTable && c.badgeNumber ? lookupByBadge(employeeTable, c.badgeNumber) : { found: false };
      return {
        callsign: c.callsign,
        badgeNumber: c.badgeNumber,
        characterName: c.name || (person.found ? person.name : ""),
        discordId: person.found ? person.discordId : "",
        hireDate: c.hireDate,
        daysInPosition: c.daysInPosition,
        // A missing/unparseable "Days in Position" cell reads as "not
        // overstayed" rather than silently flagging it -- matches the
        // reference screenshot, where the two empty placeholder rows
        // (no dash-in-red) aren't flagged either.
        overstayed: c.daysInPosition !== null && c.daysInPosition >= CADET_RESIDENCY_LIMIT_DAYS,
      };
    })
    // Longest-standing (most overdue) cadets first. Unparseable days
    // sort last rather than first/undefined-ordered.
    .sort((a, b) => (b.daysInPosition ?? -1) - (a.daysInPosition ?? -1));

  return jsonResponse({ entries, limitDays: CADET_RESIDENCY_LIMIT_DAYS }, 200);
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
