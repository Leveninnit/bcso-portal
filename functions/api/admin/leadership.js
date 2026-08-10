/**
 * Cloudflare Pages Function
 * GET/PUT /api/admin/leadership
 *
 * Lets a subdivision's own command-role holders edit that subdivision's
 * "Command Staff" directory shown on its Apply page — e.g. OCD-01,
 * OCD-02, OCD-03. Slot counts are fixed per subdivision (not
 * user-configurable): TEU/OCD/RTD go up to 03, NRED only has 01. SRT is
 * excluded entirely — it has no public application form and is treated
 * as a high-sensitivity subdivision, so it never gets a public
 * leadership listing here.
 *
 * GET ?div=slug                          -> current slots for that subdivision
 * PUT { subdivisionSlug, slotNumber, characterName, rankTitle, bio, photoUrl } -> replace exactly one slot
 *
 * Requires the D1 database bound as "DB".
 */
import { requireSession } from "../../_lib/auth-guard.js";

const MAX_SLOTS = { teu: 3, ocd: 3, rtd: 3, nred: 1 };

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  if (!div || !MAX_SLOTS[div]) {
    return jsonResponse({ error: "This subdivision doesn't have a leadership directory." }, 400);
  }
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    "SELECT slot_number, character_name, rank_title, bio, photo_url " +
      "FROM subdivision_leadership WHERE subdivision_slug = ? ORDER BY slot_number"
  )
    .bind(div)
    .all();
  return jsonResponse({ leadership: results || [] }, 200);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const slug = (body.subdivisionSlug || "").toString();
  const maxSlots = MAX_SLOTS[slug];
  if (!maxSlots) {
    return jsonResponse({ error: "This subdivision doesn't have a leadership directory." }, 400);
  }
  const slot = Number(body.slotNumber);
  if (!Number.isInteger(slot) || slot < 1 || slot > maxSlots) {
    return jsonResponse({ error: `slotNumber must be an integer from 1 to ${maxSlots} for ${slug.toUpperCase()}.` }, 400);
  }
  const session = await requireSession(request, env, slug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  const characterName = (body.characterName || "").toString().slice(0, 100);
  const rankTitle = (body.rankTitle || "").toString().slice(0, 100);
  const bio = (body.bio || "").toString().slice(0, 1000);
  const photoUrl = (body.photoUrl || "").toString().slice(0, 500);

  try {
    await env.DB.prepare(
      `INSERT INTO subdivision_leadership (subdivision_slug, slot_number, character_name, rank_title, bio, photo_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(subdivision_slug, slot_number) DO UPDATE SET
         character_name = excluded.character_name,
         rank_title = excluded.rank_title,
         bio = excluded.bio,
         photo_url = excluded.photo_url,
         updated_at = excluded.updated_at`
    )
      .bind(slug, slot, characterName, rankTitle, bio, photoUrl)
      .run();
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error("Failed to save subdivision leadership slot:", err);
    return jsonResponse({ error: "Failed to save. Try again." }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET or PUT." }, 405);
}
