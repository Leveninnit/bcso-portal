/**
 * Cloudflare Pages Function
 * /api/admin/submissions
 *
 * Lets a subdivision's command-role holders view, accept/reject, and
 * delete that subdivision's submitted applications or activity logs.
 * Per the department's decision, accept/reject only updates status
 * here — it does not DM the applicant.
 *
 * GET    ?div=slug&type=application|log[&status=pending|accepted|rejected][&limit=200&offset=0] -> list (paginated)
 * PATCH  { id, subdivisionSlug, status: "accepted"|"rejected" }             -> decide
 * DELETE ?id=..&div=slug                                                    -> remove
 *
 * Requires the D1 database bound as "DB".
 */
import { requireSession, requireFreshSession } from "../../_lib/auth-guard.js";
import { editBotMessage } from "../../_lib/discord.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function parseSubmission(row) {
  return {
    id: row.id,
    subdivisionSlug: row.subdivision_slug,
    formType: row.form_type,
    discordId: row.discord_id,
    characterName: row.character_name,
    badgeNumber: row.badge_number,
    rank: row.rank,
    coreFields: JSON.parse(row.core_fields_json || "{}"),
    answers: JSON.parse(row.answers_json || "{}"),
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  if (!div || !["application", "log"].includes(type)) {
    return jsonResponse({ error: "div and type=application|log are required." }, 400);
  }
  const session = await requireSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  // Paginated -- this list used to hard-cap at 200 rows total with no way
  // to see anything older than that. Defaults preserve the old page-1
  // behavior (200 rows) for any caller that doesn't pass limit/offset.
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || 200, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset"), 10) || 0, 0);

  let query = "SELECT * FROM submissions WHERE subdivision_slug = ? AND form_type = ?";
  const params = [div, type];
  if (status && ["pending", "accepted", "rejected"].includes(status)) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit + 1, offset); // fetch one extra row to cheaply detect "is there another page"

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  return jsonResponse({ submissions: page.map(parseSubmission), hasMore, nextOffset: offset + page.length }, 200);
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.subdivisionSlug || !["accepted", "rejected"].includes(body.status)) {
    return jsonResponse({ error: "id, subdivisionSlug, and status=accepted|rejected are required." }, 400);
  }
  // Deciding a submission is destructive-ish (it's final and drives a
  // real-world accept/reject) -- re-check live Discord roles rather than
  // trusting a stale session cookie, same reasoning as onRequestDelete.
  const session = await requireFreshSession(request, env, body.subdivisionSlug);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  // Look up which Discord message (if any) this submission came from
  // *before* updating, so a decision made here on the website can also be
  // reflected on the original Discord embed (mirrors what happens when a
  // decision is made the other way, via the Discord Approve/Reject
  // buttons — see functions/api/discord/interactions.js).
  const row = await env.DB.prepare(
    "SELECT form_type, discord_message_id, discord_channel_id FROM submissions WHERE id = ? AND subdivision_slug = ?"
  )
    .bind(body.id, body.subdivisionSlug)
    .first();

  const decidedByName = session.username || session.discordId;
  // "AND status = 'pending'" mirrors the same guard on the Discord-button
  // side (functions/api/discord/interactions.js) -- without it, deciding
  // an already-decided submission here would silently overwrite the
  // original decided_by/decided_at, e.g. if someone approves on Discord
  // and someone else rejects on the website moments later.
  const updateResult = await env.DB.prepare(
    `UPDATE submissions SET status = ?, decided_by = ?, decided_at = datetime('now')
     WHERE id = ? AND subdivision_slug = ? AND status = 'pending'`
  )
    .bind(body.status, decidedByName, body.id, body.subdivisionSlug)
    .run();
  if (!updateResult?.meta?.changes) {
    return jsonResponse(
      { error: "This submission was already decided (possibly on Discord) — refresh to see the current status." },
      409
    );
  }

  if (row && row.discord_message_id && row.discord_channel_id) {
    const verb = body.status === "accepted" ? "✅ **Approved**" : "❌ **Rejected**";
    context.waitUntil(
      editBotMessage(env, row.discord_channel_id, row.discord_message_id, {
        content: `${verb} by **${decidedByName}** on the Command Access dashboard.`,
        components: [],
      })
    );
  }

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const div = url.searchParams.get("div");
  if (!id || !div) return jsonResponse({ error: "id and div are required." }, 400);
  // Deletion is irreversible -- re-check live Discord roles instead of
  // trusting a stale session cookie (see requireFreshSession's doc comment).
  const session = await requireFreshSession(request, env, div);
  if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

  // Record an audit trail entry *before* deleting, so there's a permanent
  // record of who deleted what and when even though the submission row
  // itself is about to be gone. Best-effort: if this insert fails for some
  // reason, still proceed with the delete (an admin explicitly asked for
  // it) rather than blocking on the audit log.
  const existing = await env.DB.prepare("SELECT * FROM submissions WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .first();
  if (existing) {
    await env.DB.prepare(
      `INSERT INTO audit_log (actor_discord_id, actor_name, action, subdivision_slug, detail_json)
       VALUES (?, ?, 'delete_submission', ?, ?)`
    )
      .bind(
        session.discordId || null,
        session.username || session.discordId || "unknown",
        div,
        JSON.stringify({
          submissionId: existing.id,
          formType: existing.form_type,
          characterName: existing.character_name,
          badgeNumber: existing.badge_number,
          status: existing.status,
        })
      )
      .run()
      .catch((e) => console.error("Failed to write audit log entry:", e));
  }

  await env.DB.prepare("DELETE FROM submissions WHERE id = ? AND subdivision_slug = ?")
    .bind(id, div)
    .run();
  return jsonResponse({ ok: true }, 200);
}
