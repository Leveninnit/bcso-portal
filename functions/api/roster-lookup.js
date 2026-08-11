/**
 * Cloudflare Pages Function
 * GET /api/roster-lookup?discordId=...
 * GET /api/roster-lookup?badgeNumber=...
 *
 * Looks up a single member in the Master Roster (Google Sheet) by either
 * Discord ID or Badge Number (pass one or the other) and returns just
 * that person's name / badge number / Discord ID / rank — never the
 * whole roster. Used by apply.html and log.html to auto-fill fields so
 * members don't have to re-type their own (or someone else's) details —
 * e.g. log.html's Badge Number field, and RTD's FTO/Cadet/Supervised
 * paired Badge+Discord ID fields, all use the same lookup by whichever
 * value was typed in.
 *
 * Requires two Cloudflare environment variables (Settings -> Environment
 * variables in the Pages dashboard):
 *   ROSTER_SHEET_ID  - the spreadsheet ID (the long id in the sheet's URL,
 *                       between /d/ and /edit)
 *   ROSTER_SHEET_GID - the gid of the specific tab to read from (the
 *                       Employee Database tab, found after #gid= in the
 *                       URL when that tab is open)
 *
 * The sheet must be shared as "Anyone with the link - Viewer" so this
 * function can read it without a Google login. Only this server-side
 * function ever sees the sheet's export URL — it is never sent to the
 * browser, so visitors can't discover it just by viewing the portal's
 * source.
 *
 * Discord IDs are numeric (the account's "snowflake" ID, found via
 * Discord's own "Copy User ID" option with Developer Mode turned on) —
 * matching strips everything except digits from both the form input and
 * the sheet's Discord ID column, so formatting differences (spaces,
 * stray characters) don't break a match.
 *
 * If the roster isn't configured yet, or the lookup fails for any
 * reason, this fails soft (found: false) so the application/log forms
 * keep working — auto-fill is a convenience, never a requirement.
 *
 * TEMPORARY: pass &debug=1 to get back the parsed header row and row
 * count (no personal data) so mismatches between the sheet's column
 * names/formatting and this function's expectations can be diagnosed.
 * Remove this block once auto-fill is confirmed working.
 */
import { fetchRosterTable, lookupByDiscordId, lookupByBadge, normalizeId } from "../_lib/roster-sheet.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const discordId = normalizeId(url.searchParams.get("discordId"));
  const badgeNumber = (url.searchParams.get("badgeNumber") || "").trim();
  const debug = url.searchParams.get("debug");

  const table = await fetchRosterTable(env, { debug: !!debug });
  if (!table || !table.rows) {
    return jsonResponse(debug ? { found: false, ...table } : { found: false }, 200);
  }

  if (debug) {
    // Show the header row, row count, and the raw (unmodified) contents
    // of the Discord ID column for every row so mis-formatted cells
    // (e.g. Google turning a long ID into scientific notation) are
    // visible. No names/badges/ranks are included.
    const rawDiscordCells =
      table.idxDiscordId !== -1 ? table.rows.slice(1).map((r) => r[table.idxDiscordId]) : [];
    return jsonResponse(
      {
        found: false,
        debug: "ok",
        fetchStatus: table.fetchStatus,
        header: table.header,
        rowCount: table.rows.length - 1,
        idxDiscordId: table.idxDiscordId,
        rawDiscordCells,
        normalizedInput: discordId,
      },
      200
    );
  }

  if (!badgeNumber && !discordId) {
    return jsonResponse({ found: false, error: "Missing discordId or badgeNumber." }, 400);
  }
  const person = badgeNumber ? lookupByBadge(table, badgeNumber) : lookupByDiscordId(table, discordId);
  if (!person.found) return jsonResponse({ found: false }, 200);
  return jsonResponse(
    {
      found: true,
      name: person.name,
      badgeNumber: person.badgeNumber,
      discordId: person.discordId,
      rank: person.rank,
    },
    200
  );
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
