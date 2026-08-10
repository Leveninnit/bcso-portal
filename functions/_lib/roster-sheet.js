/**
 * Shared helper for reading the Master Roster Google Sheet (the
 * "Employee Database" tab command staff maintain), server-side.
 *
 * Used by:
 *   - functions/api/roster-lookup.js  (autofill on Apply/Log forms, by Discord ID)
 *   - functions/api/roster.js         (public per-subdivision Roster view, by Badge Number)
 *
 * Two ways to read the sheet, tried in this order:
 *
 * 1. Google Sheets API (preferred) — works for a sheet shared as
 *    "Anyone with the link - Viewer" with NO need to also "Publish to
 *    web". Requires:
 *      GOOGLE_SHEETS_API_KEY - an API key from a Google Cloud project
 *                               with the Google Sheets API enabled
 *                               (Credentials -> Create Credentials ->
 *                               API key; restrict it to the "Google
 *                               Sheets API" only). The key only ever
 *                               grants read access to sheets that are
 *                               already link-shared — nothing private.
 *      ROSTER_SHEET_TAB       - (optional) the exact tab name, defaults
 *                               to "Employee Database".
 *
 * 2. CSV export fallback (used only if GOOGLE_SHEETS_API_KEY isn't
 *    set) — https://docs.google.com/.../export?format=csv. This only
 *    works for anonymous server-side requests if the sheet has ALSO
 *    been "Published to web" (File -> Share -> Publish to web), not
 *    just link-shared. Requires ROSTER_SHEET_GID (the gid of the tab).
 *
 * Both need ROSTER_SHEET_ID - the spreadsheet ID (the long id in the
 * sheet's URL, between /d/ and /edit). Set these in Settings ->
 * Environment variables in the Cloudflare Pages dashboard. Only
 * server-side code ever sees the API key or export URL — neither is
 * ever sent to the browser.
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

function tableFromRows(rows, fetchStatus, source) {
  if (!rows.length) return { rows: null, debug: "no rows parsed", fetchStatus, source };
  const header = rows[0].map((h) => (h || "").trim().toLowerCase());
  const idxDiscordId = findColumn(header, "discord id", "discord");
  const idxName = findColumn(header, "name");
  const idxBadge = findColumn(header, "badge number", "badge");
  const idxRank = findColumn(header, "rank");
  // Department Status column (e.g. "Active" / "LOA" / "Inactive") — shown
  // on the public Roster next to each member, resolved by badge number
  // exactly like Name and Discord ID, never typed in by command staff.
  const idxDeptStatus = findColumn(header, "status");
  return { rows, header, idxDiscordId, idxName, idxBadge, idxRank, idxDeptStatus, fetchStatus, debug: "ok", source };
}

// Reads via the Google Sheets API v4 with a plain API key. Works for a
// sheet shared "Anyone with the link - Viewer" — no "Publish to web"
// needed. See file header for how to get an API key.
async function fetchViaSheetsApi(sheetId, apiKey, tabName) {
  const tab = tabName || "Employee Database";
  const range = `'${tab.replace(/'/g, "''")}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  let fetchStatus = null;
  try {
    const res = await fetch(url);
    fetchStatus = res.status;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { rows: null, debug: "sheets api fetch failed", fetchStatus, body: body.slice(0, 400), source: "sheets-api" };
    }
    const data = await res.json();
    const rows = data.values || [];
    return tableFromRows(rows, fetchStatus, "sheets-api");
  } catch (e) {
    return { rows: null, debug: "sheets api fetch threw", error: String(e), source: "sheets-api" };
  }
}

// Fallback: the CSV export URL. Only works for anonymous requests if
// the sheet has also been "Published to web" (see file header).
async function fetchViaCsvExport(sheetId, gid) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid || "0"}`;
  let fetchStatus = null;
  try {
    const res = await fetch(csvUrl);
    fetchStatus = res.status;
    if (!res.ok) {
      return { rows: null, debug: "csv export fetch failed", fetchStatus, source: "csv-export" };
    }
    const text = await res.text();
    const rows = parseCSV(text);
    return tableFromRows(rows, fetchStatus, "csv-export");
  } catch (e) {
    return { rows: null, debug: "csv export fetch threw", error: String(e), source: "csv-export" };
  }
}

// Fetches + parses the Master Roster sheet once. Returns null if it
// isn't configured or the fetch/parse fails for any reason — callers
// should treat null exactly like "nothing found."
export async function fetchRosterTable(env, { debug = false } = {}) {
  const sheetId = env.ROSTER_SHEET_ID;
  if (!sheetId) {
    return debug ? { rows: null, debug: "ROSTER_SHEET_ID not set" } : null;
  }
  const result = env.GOOGLE_SHEETS_API_KEY
    ? await fetchViaSheetsApi(sheetId, env.GOOGLE_SHEETS_API_KEY, env.ROSTER_SHEET_TAB)
    : await fetchViaCsvExport(sheetId, env.ROSTER_SHEET_GID);
  if (!result.rows) return debug ? result : null;
  return result;
}

function personFromRow(table, row) {
  return {
    found: true,
    name: table.idxName !== -1 ? (row[table.idxName] || "").trim() : "",
    badgeNumber: table.idxBadge !== -1 ? (row[table.idxBadge] || "").trim() : "",
    discordId: table.idxDiscordId !== -1 ? normalizeId(row[table.idxDiscordId]) : "",
    rank: table.idxRank !== -1 ? (row[table.idxRank] || "").trim() : "",
    departmentStatus: table.idxDeptStatus !== -1 ? (row[table.idxDeptStatus] || "").trim() : "",
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
