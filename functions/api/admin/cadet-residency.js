/**
 * Cloudflare Pages Function
 * GET /api/admin/cadet-residency?div=slug
 *
 * "Cadet Residency" -- Command Access -> RTD -> Cadet Residency. Lists
 * every entry on this subdivision's Roster (see
 * functions/api/admin/roster.js) currently ranked "Cadet"
 * (case-insensitive, trimmed match -- same convention used for the
 * rank-hierarchy sort/exemption matching in functions/api/roster.js),
 * how many days they've held that rank, and flags anyone over BCSO's
 * 14-day cadet residency limit as needing to be removed.
 *
 * "How long they've held that rank" comes from roster_entries.rank_since
 * (added by migration-8.sql), which functions/api/admin/roster.js's
 * POST/PUT handlers keep in sync -- it's only refreshed when the Rank
 * field's value actually changes, not on every edit (unlike the generic
 * updated_at column), so promoting someone out of Cadet and back in
 * later correctly restarts their clock instead of carrying over old time.
 *
 * Character Name and Discord ID aren't stored in roster_entries (same as
 * the public Roster) -- resolved live from the Master Roster Google
 * Sheet by badge number, same as functions/api/roster.js.
 *
 * Gated the same way as every other Command Access panel: requires a
 * valid session for this exact subdivision
 * (functions/_lib/auth-guard.js). The UI only shows this tab for RTD
 * (Recruitment & Training is the subdivision that actually uses "Cadet"
 * as a roster rank), but this endpoint isn't hardcoded to that slug --
 * it works for any subdivision whose Roster happens to use "Cadet".
 *
 * Removing someone flagged here is just a normal Roster delete -- reuse
 * DELETE /api/admin/roster?id=..&div=.. (see command-access.js's
 * handleCadetResidencyRemove), no separate endpoint needed.
 */
import { requireSession } from "../../_lib/auth-guard.js";
import { fetchRosterTable, lookupByBadge } from "../../_lib/roster-sheet.js";

const CADET_RESIDENCY_LIMIT_DAYS = 14;
const CADET_RANK_LABEL = "cadet";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizeRankLabel(value) {
  return (value || "").toString().trim().toLowerCase();
}

// D1's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no "Z") --
// same handling as assets/leaderboards.js's formatDate for why the
// space needs to become a "T" plus an explicit "Z" before Date() will
// parse it as UTC instead of local time.
function parseD1Timestamp(value) {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div) return jsonResponse({ error: "div is required." }, 400);
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT id, rank, badge_number, notes, rank_since FROM roster_entries WHERE subdivision_slug = ? ORDER BY rank_since ASC, id ASC"
  )
    .bind(div)
    .all();
  const cadetRows = (results || []).filter((r) => normalizeRankLabel(r.rank) === CADET_RANK_LABEL);

  if (!cadetRows.length) {
    return jsonResponse({ entries: [], limitDays: CADET_RESIDENCY_LIMIT_DAYS }, 200);
  }

  // Same live Master Roster lookup as the public roster -- Character
  // Name/Discord ID are never stored in roster_entries. Fails soft: if
  // the sheet can't be reached, entries still render with blank
  // name/discordId rather than the whole panel breaking.
  const table = await fetchRosterTable(env);
  const now = Date.now();
  const entries = cadetRows.map((r) => {
    const person = table ? lookupByBadge(table, r.badge_number) : { found: false };
    const since = parseD1Timestamp(r.rank_since);
    // No rank_since (shouldn't happen for anything created/edited after
    // migration-8.sql, but defends against a row that slipped through)
    // reads as "just started" rather than as instantly overstayed.
    const daysInPosition = since ? Math.floor((now - since.getTime()) / MS_PER_DAY) : 0;
    return {
      id: r.id,
      badgeNumber: r.badge_number,
      notes: r.notes,
      characterName: person.found ? person.name : "",
      discordId: person.found ? person.discordId : "",
      rankSince: r.rank_since,
      daysInPosition,
      overstayed: daysInPosition > CADET_RESIDENCY_LIMIT_DAYS,
    };
  });

  return jsonResponse({ entries, limitDays: CADET_RESIDENCY_LIMIT_DAYS }, 200);
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
