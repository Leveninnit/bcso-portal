/**
 * Cloudflare Pages Function
 * POST /api/admin/emergency-alert
 *
 * The Command Access dashboard's "Emergency Alert" button — lets a
 * subdivision head send an urgent, personally-typed message straight to
 * the department's emergency contact as a Discord DM, for situations
 * that can't wait for a normal post in a channel to be seen. This is
 * deliberately a much shorter, higher-visibility path than posting in
 * Discord and hoping someone's online — see assets/command-access.js for
 * the confirmation step the dashboard requires before this ever fires.
 *
 * Restricted to people who hold at least one subdivision's command role
 * (i.e. an actual "head of a subdivision" — matches who sees the
 * Emergency Alert button at all client-side). A valid Command Access
 * session by itself isn't enough; someone with only High Command access
 * and no subdivision role can't use this.
 *
 * Every use — successful or not — is written to audit_log (action:
 * "emergency_alert") with the sender and full message text, so misuse is
 * traceable after the fact. That's what makes the dashboard's warning
 * ("misuse is insubordination") an enforceable statement rather than an
 * empty one.
 *
 * A DM failing to send (DMs closed, bot removed from the server, etc.)
 * is reported back to the sender as an error rather than swallowed --
 * unlike the best-effort DMs elsewhere in this app, silently failing
 * here would defeat the entire point of an emergency channel.
 *
 * POST { message } -> { ok: true } once the DM is confirmed sent.
 *
 * Requires DISCORD_BOT_TOKEN. Requires the D1 database bound as "DB" for
 * the audit trail (the alert still sends without it, best-effort).
 */
import { requireSession } from "../../_lib/auth-guard.js";
import { sendDirectMessage } from "../../_lib/discord.js";

// The department's emergency contact. Not per-subdivision, not
// configurable from the dashboard -- intentionally a single fixed
// destination so this can't be quietly redirected.
const EMERGENCY_CONTACT_DISCORD_ID = "1405937468984787014";
const MAX_MESSAGE_LEN = 1500;
// Best-effort, module-scope cooldown -- same "a Workers isolate is
// commonly reused across requests" reasoning as the caches in
// discord.js. Not a durable rate limit (a cold isolate resets it), just
// cheap insurance against a reflexive double-click or double-submit
// firing off two DMs a few seconds apart.
const COOLDOWN_MS = 60 * 1000;
const lastSentAt = new Map();

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await requireSession(request, env);
  if (!session || !(session.subdivisions || []).length) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  if (!env.DISCORD_BOT_TOKEN) {
    return jsonResponse({ error: "Emergency alerts aren't configured yet — contact command staff another way." }, 500);
  }

  const body = await request.json().catch(() => null);
  const message = body && typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return jsonResponse({ error: "A message is required." }, 400);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return jsonResponse({ error: `Message must be ${MAX_MESSAGE_LEN} characters or fewer.` }, 400);
  }

  const actorKey = session.discordId || session.username || "unknown";
  const lastAt = lastSentAt.get(actorKey);
  if (lastAt && Date.now() - lastAt < COOLDOWN_MS) {
    return jsonResponse({ error: "Please wait a moment before sending another emergency alert." }, 429);
  }

  const senderName = session.username || session.discordId || "someone on Command Access";
  const subdivisionTag = (session.subdivisions || []).map((s) => s.toUpperCase()).join(", ") || "no subdivision on file";
  const dmContent =
    `🚨 **EMERGENCY ALERT — Command Access**\n` +
    `From: **${senderName}** (${subdivisionTag})\n\n` +
    message;

  const result = await sendDirectMessage(env, EMERGENCY_CONTACT_DISCORD_ID, dmContent);

  // Logged regardless of delivery success -- a failed send is still an
  // attempted use of the button and belongs in the trail, and knowing
  // delivery failed is itself useful if this ever needs to be reviewed.
  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO audit_log (actor_discord_id, actor_name, action, subdivision_slug, detail_json)
       VALUES (?, ?, 'emergency_alert', ?, ?)`
    )
      .bind(
        session.discordId || null,
        senderName,
        (session.subdivisions || [])[0] || null,
        JSON.stringify({
          message,
          subdivisions: session.subdivisions || [],
          delivered: result.ok,
          deliveryError: result.ok ? null : result.error,
        })
      )
      .run()
      .catch((e) => console.error("Failed to write audit log entry for emergency alert:", e));
  }

  if (!result.ok) {
    return jsonResponse({ error: `Couldn't deliver the alert (${result.error}) — contact command staff another way.` }, 502);
  }

  lastSentAt.set(actorKey, Date.now());
  return jsonResponse({ ok: true }, 200);
}

export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
}
