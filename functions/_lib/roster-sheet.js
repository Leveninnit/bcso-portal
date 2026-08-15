/**
 * Shared helper for reading the Master Roster Google Sheet, server-side.
 * The spreadsheet (ROSTER_SHEET_ID) has multiple tabs; this file reads
 * two of them:
 *
 *   - "Employee Database" (or ROSTER_SHEET_TAB) — the main roster of
 *     every member, keyed by Badge Number / Discord ID. Used by:
 *       - functions/api/roster-lookup.js  (autofill on Apply/Log forms, by Discord ID)
 *       - functions/api/roster.js         (public per-subdivision Roster view, by Badge Number)
 *   - "Cadet Roster" (identified by gid, see CADET_ROSTER_GID below) —
 *     a separate tab command staff maintain with one row per cadet and
 *     an already-computed "Days in Position" column. Used by:
 *       - functions/api/admin/cadet-residency.js (Command Access -> RTD -> Cadet Residency)
 *
 * Two ways to read a tab, tried in this order:
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
 *      ROSTER_SHEET_TAB       - (optional) the Employee Database tab's
 *                               exact name, defaults to "Employee
 *                               Database". Not used for the Cadet
 *                               Roster tab — that one is looked up by
 *                               gid instead (see resolveTabNameByGid),
 *                               since it isn't published to web (see
 *                               below) and its exact display name isn't
 *                               otherwise known to this code.
 *
 * 2. CSV export fallback (used only if GOOGLE_SHEETS_API_KEY isn't
 *    set) — https://docs.google.com/.../export?format=csv. This only
 *    works for anonymous server-side requests if the sheet has ALSO
 *    been "Published to web" (File -> Share -> Publish to web), not
 *    just link-shared. Requires ROSTER_SHEET_GID (the gid of the
 *    Employee Database tab) — the Cadet Roster tab is NOT published to
 *    web, so this fallback can't read it at all; GOOGLE_SHEETS_API_KEY
 *    is required for fetchCadetRosterTable to work.
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

// The Cadet Roster tab's gid (from its Google Sheets URL, .../edit?gid=N).
// Overridable via the CADET_ROSTER_GID env var in case command staff
// ever recreate the tab and it ends up with a different gid.
const DEFAULT_CADET_ROSTER_GID = "1791604270";

// Google Sheets sometimes stores a long numeric-looking cell (a Discord
// ID typed or pasted without forcing Text format) as a Number, which
// then reads/exports as scientific notation, e.g.
// "3.72504974311633E+17" instead of the literal digit string. Expands
// that back into a plain digit string by shifting the decimal point
// according to the exponent -- done with plain string math, not
// Number(), so it doesn't introduce any *additional* rounding beyond
// whatever Sheets already baked into the notation. Returns null if the
// string isn't scientific notation.
//
// NOTE: this can't recover precision Sheets already lost. Discord IDs
// are 17-19 digits, well past a float64's ~15-17 significant digits, so
// if the sheet cell is formatted as a Number (not Text), some of the
// least-significant digits may already be wrong/zeroed by the time this
// ever sees them. The only real fix is formatting that column as Text
// in the sheet; this just stops making an already-imprecise value worse.
function expandScientificNotation(str) {
  const m = /^(-?)(\d+)(?:\.(\d+))?e\+?(\d+)$/i.exec(str.trim());
  if (!m) return null;
  const [, sign, intPart, fracPart = "", expStr] = m;
  const exp = parseInt(expStr, 10);
  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  const result =
    pointPos >= digits.length ? digits + "0".repeat(pointPos - digits.length) : digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  return sign + result;
}

export function normalizeId(value) {
  let str = (value || "").toString().trim();
  if (/^-?\d+(\.\d+)?e\+?\d+$/i.test(str)) {
    const expanded = expandScientificNotation(str);
    if (expanded) str = expanded;
  }
  return str.replace(/[^0-9]/g, "");
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

// ---- Raw row fetchers (no column-mapping) ------------------------------
//
// These just get { rows, fetchStatus, source, debug?, error?, body? } for
// a given tab, so both the Employee Database parsing (tableFromRows) and
// the Cadet Roster parsing (cadetTableFromRows) can share the same HTTP
// fetch logic instead of each reimplementing it.

// Reads via the Google Sheets API v4 with a plain API key. Works for a
// sheet shared "Anyone with the link - Viewer" — no "Publish to web"
// needed. See file header for how to get an API key. tabName is
// required here (callers pick the default, e.g. "Employee Database").
async function fetchRowsViaSheetsApi(sheetId, apiKey, tabName) {
  const range = `'${tabName.replace(/'/g, "''")}'`;
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
    return { rows: data.values || [], fetchStatus, source: "sheets-api" };
  } catch (e) {
    return { rows: null, debug: "sheets api fetch threw", error: String(e), source: "sheets-api" };
  }
}

// Fallback: the CSV export URL. Only works for anonymous requests if
// the sheet has also been "Published to web" (see file header).
async function fetchRowsViaCsvExport(sheetId, gid) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid || "0"}`;
  let fetchStatus = null;
  try {
    const res = await fetch(csvUrl);
    fetchStatus = res.status;
    if (!res.ok) {
      return { rows: null, debug: "csv export fetch failed", fetchStatus, source: "csv-export" };
    }
    const text = await res.text();
    return { rows: parseCSV(text), fetchStatus, source: "csv-export" };
  } catch (e) {
    return { rows: null, debug: "csv export fetch threw", error: String(e), source: "csv-export" };
  }
}

// ---- Employee Database tab (existing behavior, unchanged) --------------

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

async function fetchViaSheetsApi(sheetId, apiKey, tabName) {
  const raw = await fetchRowsViaSheetsApi(sheetId, apiKey, tabName || "Employee Database");
  if (!raw.rows) return raw;
  return tableFromRows(raw.rows, raw.fetchStatus, raw.source);
}

async function fetchViaCsvExport(sheetId, gid) {
  const raw = await fetchRowsViaCsvExport(sheetId, gid);
  if (!raw.rows) return raw;
  return tableFromRows(raw.rows, raw.fetchStatus, raw.source);
}

// Module-scope cache, same idea (and same isolate-reuse caveat) as
// resolveWebhookChannelId's cache in discord.js. The roster sheet is read
// on essentially every Apply/Log form autofill (both Discord ID blur AND
// Badge Number blur) plus every Roster page view -- without this, a
// member re-typing/correcting one character in a field could trigger a
// fresh full-sheet fetch+parse per keystroke-triggered blur. A short TTL
// keeps this from ever being more than a couple minutes stale.
let rosterTableCache = null; // { result, at }
const ROSTER_TABLE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Fetches + parses the Master Roster sheet's Employee Database tab once.
// Returns null if it isn't configured or the fetch/parse fails for any
// reason — callers should treat null exactly like "nothing found."
export async function fetchRosterTable(env, { debug = false } = {}) {
  const sheetId = env.ROSTER_SHEET_ID;
  if (!sheetId) {
    return debug ? { rows: null, debug: "ROSTER_SHEET_ID not set" } : null;
  }
  // debug mode always does a live fetch -- the whole point is diagnosing
  // what's actually coming back from the sheet right now.
  if (!debug && rosterTableCache && Date.now() - rosterTableCache.at < ROSTER_TABLE_CACHE_TTL_MS) {
    return rosterTableCache.result;
  }
  const result = env.GOOGLE_SHEETS_API_KEY
    ? await fetchViaSheetsApi(sheetId, env.GOOGLE_SHEETS_API_KEY, env.ROSTER_SHEET_TAB)
    : await fetchViaCsvExport(sheetId, env.ROSTER_SHEET_GID);
  if (!result.rows) return debug ? result : null;
  if (!debug) rosterTableCache = { result, at: Date.now() };
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
  // .find() only ever returns the first match. If the sheet has more than
  // one row with the same Discord ID (a copy/paste duplicate, someone
  // re-added instead of edited, etc.), earlier code would pick one of
  // them with no indication the match was ambiguous -- possibly
  // resolving to the wrong person's badge/rank silently. `ambiguous: true`
  // lets callers at least log/flag it instead of trusting it blindly; the
  // first match is still returned so behavior otherwise doesn't change.
  const matches = table.rows.slice(1).filter((r) => normalizeId(r[table.idxDiscordId]) === target);
  if (!matches.length) return { found: false };
  const result = personFromRow(table, matches[0]);
  if (matches.length > 1) result.ambiguous = true;
  return result;
}

export function lookupByBadge(table, badgeNumber) {
  if (!table || table.idxBadge === -1) return { found: false };
  const target = normalizeBadge(badgeNumber);
  if (!target) return { found: false };
  // See the duplicate-match note in lookupByDiscordId above.
  const matches = table.rows.slice(1).filter((r) => normalizeBadge(r[table.idxBadge]) === target);
  if (!matches.length) return { found: false };
  const result = personFromRow(table, matches[0]);
  if (matches.length > 1) result.ambiguous = true;
  return result;
}

// ---- Cadet Roster tab ----------------------------------------------------

// The Cadet Roster tab isn't "Published to web," so it can't be read by
// gid via CSV export (that returns 401 anonymously) -- only the Sheets
// API can read it, and that endpoint addresses tabs by name, not gid.
// This resolves the tab's current display name from its gid via the
// spreadsheet metadata endpoint, so command staff don't have to keep an
// env var in sync with the tab's exact title (which can be renamed).
// Cached with a longer TTL than the row data itself since a tab's name
// changes far less often than its contents.
let tabNameCache = null; // { key, name, at }
const TAB_NAME_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes -- renamed rarely

async function resolveTabNameByGid(sheetId, apiKey, gid) {
  const cacheKey = `${sheetId}:${gid}`;
  if (tabNameCache && tabNameCache.key === cacheKey && Date.now() - tabNameCache.at < TAB_NAME_CACHE_TTL_MS) {
    return tabNameCache.name;
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=${encodeURIComponent("sheets.properties")}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const sheets = data.sheets || [];
    const match = sheets.find((s) => String(s.properties?.sheetId) === String(gid));
    if (!match) return null;
    const name = match.properties.title;
    tabNameCache = { key: cacheKey, name, at: Date.now() };
    return name;
  } catch (e) {
    return null;
  }
}

function cadetTableFromRows(rows, fetchStatus, source) {
  if (!rows.length) return { rows: null, debug: "no rows parsed", fetchStatus, source };
  const header = rows[0].map((h) => (h || "").trim().toLowerCase());
  const idxCallsign = findColumn(header, "callsign", "call sign");
  const idxBadge = findColumn(header, "badge number", "badge");
  const idxName = findColumn(header, "name");
  const idxRank = findColumn(header, "rank");
  const idxHireDate = findColumn(header, "hire date", "hire");
  const idxDays = findColumn(header, "days in position", "days");
  return { rows, header, idxCallsign, idxBadge, idxName, idxRank, idxHireDate, idxDays, fetchStatus, debug: "ok", source };
}

let cadetTableCache = null; // { result, at }
const CADET_TABLE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes, matches ROSTER_TABLE_CACHE_TTL_MS

// Fetches + parses the Cadet Roster tab once. Requires
// GOOGLE_SHEETS_API_KEY (the CSV-export fallback can't reach this tab —
// see file header), plus ROSTER_SHEET_ID. Returns null if not configured
// or the fetch/parse/tab-lookup fails for any reason.
export async function fetchCadetRosterTable(env, { debug = false } = {}) {
  const sheetId = env.ROSTER_SHEET_ID;
  const apiKey = env.GOOGLE_SHEETS_API_KEY;
  if (!sheetId || !apiKey) {
    return debug ? { rows: null, debug: "ROSTER_SHEET_ID or GOOGLE_SHEETS_API_KEY not set" } : null;
  }
  if (!debug && cadetTableCache && Date.now() - cadetTableCache.at < CADET_TABLE_CACHE_TTL_MS) {
    return cadetTableCache.result;
  }
  const gid = env.CADET_ROSTER_GID || DEFAULT_CADET_ROSTER_GID;
  const tabName = await resolveTabNameByGid(sheetId, apiKey, gid);
  if (!tabName) {
    return debug ? { rows: null, debug: "could not resolve Cadet Roster tab name from gid", gid } : null;
  }
  const raw = await fetchRowsViaSheetsApi(sheetId, apiKey, tabName);
  if (!raw.rows) return debug ? raw : null;
  const result = cadetTableFromRows(raw.rows, raw.fetchStatus, raw.source);
  if (!result.rows) return debug ? result : null;
  if (!debug) cadetTableCache = { result, at: Date.now() };
  return result;
}

// Maps one Cadet Roster row into a plain object. daysInPosition is
// parsed as an integer straight from the sheet's own pre-computed
// column -- no date math needed here. Returns null for daysInPosition
// if that cell is empty/unparseable (e.g. a placeholder row).
export function cadetFromRow(table, row) {
  const daysRaw = table.idxDays !== -1 ? (row[table.idxDays] || "").toString().trim() : "";
  const daysParsed = parseInt(daysRaw, 10);
  return {
    callsign: table.idxCallsign !== -1 ? (row[table.idxCallsign] || "").trim() : "",
    badgeNumber: table.idxBadge !== -1 ? (row[table.idxBadge] || "").trim() : "",
    name: table.idxName !== -1 ? (row[table.idxName] || "").trim() : "",
    rank: table.idxRank !== -1 ? (row[table.idxRank] || "").trim() : "",
    hireDate: table.idxHireDate !== -1 ? (row[table.idxHireDate] || "").trim() : "",
    daysInPosition: Number.isFinite(daysParsed) ? daysParsed : null,
  };
}
