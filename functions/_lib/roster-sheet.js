/**
 * Shared helper for reading the Master Roster Google Sheet (the
 * "Employee Database" tab command staff maintain) as CSV, server-side.
 *
 * Used by:
 *   - functions/api/roster-lookup.js  (autofill on Apply/Log forms, by Discord ID)
 *   - functions/api/roster.js         (public per-subdivision Roster view, by Badge Number)
 *
 * Requires two Cloudflare environment variables (Settings -> Environment
 * variables in the Pages dashboard):
 *   ROSTER_SHEET_ID  - the spreadsheet ID (the long id in the sheet's URL,
 *                       between /d/ and /edit)
 *   ROSTER_SHEET_GID - the gid of the specific tab to read from (the
 *                       Employee Database tab, found after #gid= in the
 *                       URL when that tab is open)
 *
 * The sheet must be shared as "Anyone with the link - Viewer" so this can
 * read it without a Google login. Only server-side code ever sees the
 * sheet's export URL — it's never sent to the browser.
 *
 * Every function here fails soft (returns null / false / empty), never
 * throws — a roster lookup is always a convenience layered on top of
 * data that lives elsewhere, never something that should break a page.
 */

export function normalizeId(value) {
  return (value || "").toString().replace(/[^0-9]/g, "");
}

// Loose match for badge numbers: strips everything except letters and
// digits and uppercases, so "1042", " 1042 ", "#1042" all match.
export function normalizeBadge(value) {
  return (value || "").toString().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

function findColumn(header, ...candidates) {
  for (const candidate of candidates) {
    const idx = header.findIndex((h) => h === candidate);
    if (idx !== -1) return idx;
  }
  for (const candidate of candidates) {
    const idx = header.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Fetches + parses the Master Roster sheet once. Returns null if it
// isn't configured or the fetch/parse fails for any reason — callers
// should treat null exactly like "nothing found."
export async function fetchRosterTable(env, { debug = false } = {}) {
  const sheetId = env.ROSTER_SHEET_ID;
  const gid = env.ROSTER_SHEET_GID || "0";
  if (!sheetId) {
    return debug ? { rows: null, debug: "ROSTER_SHEET_ID not set" } : null;
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  let rows;
  let fetchStatus = null;
  try {
    const res = await fetch(csvUrl);
    fetchStatus = res.status;
    if (!res.ok) {
      return debug ? { rows: null, debug: "fetch failed", fetchStatus } : null;
    }
    const text = await res.text();
    rows = parseCSV(text);
  } catch (e) {
    return debug ? { rows: null, debug: "fetch threw", error: String(e) } : null;
  }
  if (!rows.length) {
    return debug ? { rows: null, debug: "no rows parsed", fetchStatus } : null;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idxDiscordId = findColumn(header, "discord id", "discord");
  const idxName = findColumn(header, "name");
  const idxBadge = findColumn(header, "badge number", "badge");
  const idxRank = findColumn(header, "rank");
  const table = { rows, header, idxDiscordId, idxName, idxBadge, idxRank, fetchStatus };
  return debug ? { ...table, debug: "ok" } : table;
}

function personFromRow(table, row) {
  return {
    found: true,
    name: table.idxName !== -1 ? (row[table.idxName] || "").trim() : "",
    badgeNumber: table.idxBadge !== -1 ? (row[table.idxBadge] || "").trim() : "",
    discordId: table.idxDiscordId !== -1 ? normalizeId(row[table.idxDiscordId]) : "",
    rank: table.idxRank !== -1 ? (row[table.idxRank] || "").trim() : "",
  };
}

export function lookupByDiscordId(table, discordId) {
  if (!table || table.idxDiscordId === -1) return { found: false };
  const target = normalizeId(discordId);
  if (!target) return { found: false };
  const match = table.rows.slice(1).find((r) => normalizeId(r[table.idxDiscordId]) === target);
  return match ? personFromRow(table, match) : { found: false };
}

export function lookupByBadge(table, badgeNumber) {
  if (!table || table.idxBadge === -1) return { found: false };
  const target = normalizeBadge(badgeNumber);
  if (!target) return { found: false };
  const match = table.rows.slice(1).find((r) => normalizeBadge(r[table.idxBadge]) === target);
  return match ? personFromRow(table, match) : { found: false };
}
