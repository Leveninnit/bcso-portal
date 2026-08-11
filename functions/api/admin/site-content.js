/**
 * Cloudflare Pages Function
 * GET/PUT /api/admin/site-content
 *
 * High-Command-only editor for the homepage's Deputy of the Week, Deputy
 * of the Month, and Patrol Photos sections. Gated the same way as
 * /api/admin/team (the isHighCommand flag set on the session at login) —
 * whoever can edit the Meet the Team roster can edit these too.
 *
 * Photos are admin-pasted URLs (no upload/storage system) — same
 * approach as the existing team_roster photo_url field.
 *
 * GET returns the current content. PUT replaces all three sections at
 * once (the editor page sends the full set every save).
 */
import { requireSession } from "../../_lib/auth-guard.js";

const MAX_PHOTOS = 8;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function checkAccess(request, env) {
  const session = await requireSession(request, env);
  if (!session) return { ok: false, status: 401 };
  if (!session.isHighCommand) return { ok: false, status: 403 };
  return { ok: true, session };
}
function accessDeniedResponse(status) {
  return jsonResponse(
    { error: status === 401 ? "Not signed in." : "High Command access required." },
    status
  );
}

function cleanDeputy(d) {
  const v = d && typeof d === "object" ? d : {};
  return {
    characterName: (v.characterName || "").toString().slice(0, 100),
    rankTitle: (v.rankTitle || "").toString().slice(0, 100),
    subdivisionSlug: (v.subdivisionSlug || "").toString().slice(0, 30),
    photoUrl: (v.photoUrl || "").toString().slice(0, 500),
    blurb: (v.blurb || "").toString().slice(0, 500),
  };
}
function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .slice(0, MAX_PHOTOS)
    .map((p) => ({
      url: (p && p.url ? p.url : "").toString().slice(0, 500),
      caption: (p && p.caption ? p.caption : "").toString().slice(0, 200),
    }))
    .filter((p) => p.url);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const access = await checkAccess(request, env);
  if (!access.ok) return accessDeniedResponse(access.status);
  if (!env.DB) return jsonResponse({ deputyOfWeek: {}, deputyOfMonth: {}, patrolPhotos: [] }, 200);

  try {
    const { results } = await env.DB.prepare(
      "SELECT content_key, value_json FROM site_content WHERE content_key IN ('deputy_of_week','deputy_of_month','patrol_photos')"
    ).all();
    const values = {};
    for (const row of results || []) {
      try {
        values[row.content_key] = JSON.parse(row.value_json);
      } catch {
        /* ignore malformed row */
      }
    }
    return jsonResponse(
      {
        deputyOfWeek: values.deputy_of_week || {},
        deputyOfMonth: values.deputy_of_month || {},
        patrolPhotos: values.patrol_photos || [],
      },
      200
    );
  } catch (err) {
    console.error("Failed to load site content:", err);
    return jsonResponse({ error: "Failed to load. Try again." }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const access = await checkAccess(request, env);
  if (!access.ok) return accessDeniedResponse(access.status);
  if (!env.DB) return jsonResponse({ error: "Database not configured." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  // A body of literal JSON `null` parses without throwing above -- guard
  // against it (and any other non-object) before touching its fields.
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const rows = [
    ["deputy_of_week", cleanDeputy(body.deputyOfWeek)],
    ["deputy_of_month", cleanDeputy(body.deputyOfMonth)],
    ["patrol_photos", cleanPhotos(body.patrolPhotos)],
  ];

  try {
    for (const [key, value] of rows) {
      await env.DB.prepare(
        `INSERT INTO site_content (content_key, value_json, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(content_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
        .bind(key, JSON.stringify(value))
        .run();
    }
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Failed to save site content:", err);
    return jsonResponse({ error: "Failed to save. Try again." }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET or PUT." }, 405);
}
