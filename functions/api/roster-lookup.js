/**
 * Cloudflare Pages Function
 * GET /api/roster-lookup?discordId=...
 *
 * Looks up a single member in the Master Roster (Google Sheet) by Discord
 * ID and returns just that person's name / badge number / rank — never
 * the whole roster. Used by apply.html and log.html to auto-fill fields
 * so members don't have to re-type their own details.
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
 * If the roster isn't configured yet, or the lookup fails for any
 * reason, this fails soft (found: false) so the application/log forms
 * keep working — auto-fill is a convenience, never a requirement.
 */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Never let this be cached by shared/browser caches — it's a
      // per-person lookup, not static content.
      "Cache-Control": "no-store",
    },
  });
}
function normalizeId(value) {
  return (value || "").toString().replace(/[^0-9]/g, "");
}
// Minimal CSV parser: handles quoted fields, embedded commas, embedded
// quotes ("") and embedded newlines inside quotes — everything Google
// Sheets' CSV export can produce.
function parseCSV(text) {
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
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const discordId = normalizeId(url.searchParams.get("discordId"));
  if (!discordId) {
    return jsonResponse({ found: false, error: "Missing discordId." }, 400);
  }
  const sheetId = env.ROSTER_SHEET_ID;
  const gid = env.ROSTER_SHEET_GID || "0";
  if (!sheetId) {
    // Roster lookup isn't configured — fail soft.
    return jsonResponse({ found: false }, 200);
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  let rows;
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) return jsonResponse({ found: false }, 200);
    const text = await res.text();
    rows = parseCSV(text);
  } catch {
    return jsonResponse({ found: false }, 200);
  }
  if (!rows.length) return jsonResponse({ found: false }, 200);
  // First row is the header — match columns by name (not position) so
  // this keeps working even if columns get reordered in the sheet later.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idxDiscordId = findColumn(header, "discord id", "discord");
  const idxName = findColumn(header, "name");
  const idxBadge = findColumn(header, "badge number", "badge");
  const idxRank = findColumn(header, "rank");
  if (idxDiscordId === -1) return jsonResponse({ found: false }, 200);
  const match = rows
    .slice(1)
    .find((r) => normalizeId(r[idxDiscordId]) === discordId);
  if (!match) return jsonResponse({ found: false }, 200);
  return jsonResponse(
    {
      found: true,
      name: idxName !== -1 ? (match[idxName] || "").trim() : "",
      badgeNumber: idxBadge !== -1 ? (match[idxBadge] || "").trim() : "",
      rank: idxRank !== -1 ? (match[idxRank] || "").trim() : "",
    },
    200
  );
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
