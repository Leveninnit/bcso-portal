/**
 * Cloudflare Pages Function
 * POST /api/discord/interactions
 *
 * Discord's HTTP Interactions Endpoint — this is what makes the
 * Approve/Reject buttons on application/log embeds (see
 * functions/_lib/discord.js's buildDecisionComponents) actually do
 * something when clicked, instead of just sitting there.
 *
 * One-time setup required (not done yet — this endpoint safely no-ops
 * until it is):
 *   1. In the Discord Developer Portal, on this bot's application, copy
 *      its "Public Key" (General Information tab).
 *   2. Add it as a Cloudflare Pages environment variable named
 *      DISCORD_PUBLIC_KEY (Settings -> Environment variables).
 *   3. Set "Interactions Endpoint URL" (same General Information tab) to
 *      https://<your-domain>/api/discord/interactions and save — Discord
 *      sends a PING here immediately to confirm it works.
 * Until DISCORD_PUBLIC_KEY is set, this endpoint returns 501 for every
 * request, so registering it in Discord will simply fail with a clear
 * "endpoint didn't respond correctly" until step 2 is done — nothing
 * else on the site is affected either way, and the buttons on the embeds
 * are harmless in the meantime (clicking one just shows Discord's
 * generic "This interaction failed" message).
 *
 * Every decision made here also mirrors onto the website — the same
 * `submissions` row is updated, so it shows up correctly (status +
 * "Decided by") on the Command Access dashboard too. This is the Discord
 * side of the same sync admin/submissions.js does for the website side.
 */
import { verifyDiscordInteraction, SUBDIVISION_COMMAND_ROLES } from "../../_lib/discord.js";

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Ephemeral (visible only to the clicker) reply helper for error/denied cases.
function ephemeral(content) {
  return jsonResponse({ type: 4, data: { content, flags: 64 } }, 200);
}

async function handleDecisionButton(context, interaction) {
  const { env } = context;
  const parts = String(interaction.data.custom_id || "").split(":");
  const [prefix, action, id, formType, subdivisionSlug] = parts;
  if (prefix !== "bcso_decide" || !["accept", "reject"].includes(action) || !id || !formType || !subdivisionSlug) {
    return ephemeral("This button isn't recognized.");
  }

  // Authorize: the clicking member must hold this subdivision's command
  // role — the same permission boundary the website enforces via
  // requireSession(request, env, subdivisionSlug).
  const memberRoles = (interaction.member && interaction.member.roles) || [];
  const commandRoleId = SUBDIVISION_COMMAND_ROLES[subdivisionSlug];
  if (!commandRoleId || !memberRoles.includes(commandRoleId)) {
    return ephemeral("You need this subdivision's command role to decide on this.");
  }

  const status = action === "accept" ? "accepted" : "rejected";
  const user = (interaction.member && interaction.member.user) || {};
  const decidedByName = interaction.member.nick || user.global_name || user.username || "someone on Discord";

  if (!env.DB) {
    return ephemeral("Database isn't configured — couldn't save that decision.");
  }
  try {
    const result = await env.DB.prepare(
      `UPDATE submissions SET status = ?, decided_by = ?, decided_at = datetime('now')
       WHERE id = ? AND subdivision_slug = ? AND form_type = ?`
    )
      .bind(status, decidedByName, id, subdivisionSlug, formType)
      .run();
    if (!result?.meta?.changes) {
      return ephemeral("Couldn't find that submission — it may have already been decided or deleted.");
    }
  } catch (err) {
    console.error("Failed to record Discord decision in D1:", err);
    return ephemeral("Couldn't save that decision — try again in a moment.");
  }

  const verb = status === "accepted" ? "✅ **Approved**" : "❌ **Rejected**";
  // UPDATE_MESSAGE: directly edits the message the button is attached to
  // as part of this same response — no separate Discord API call needed.
  return jsonResponse(
    { type: 7, data: { content: `${verb} by **${decidedByName}**.`, components: [] } },
    200
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DISCORD_PUBLIC_KEY) {
    return jsonResponse({ error: "Discord interactions are not configured yet." }, 501);
  }

  const rawBody = await request.text();
  const valid = await verifyDiscordInteraction(request, rawBody, env.DISCORD_PUBLIC_KEY);
  if (!valid) {
    return new Response("Bad request signature.", { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid interaction payload." }, 400);
  }

  if (interaction.type === 1) {
    // PING — Discord sends this once when you register/save the
    // Interactions Endpoint URL, and expects exactly this back.
    return jsonResponse({ type: 1 }, 200);
  }

  if (interaction.type === 3 && interaction.data && typeof interaction.data.custom_id === "string") {
    return handleDecisionButton(context, interaction);
  }

  return ephemeral("Unsupported interaction.");
}

export async function onRequestGet() {
  return jsonResponse({ error: "Discord sends interactions via POST only." }, 405);
}
