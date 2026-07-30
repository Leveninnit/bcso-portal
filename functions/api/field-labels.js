/**
 * Cloudflare Pages Function
 * GET /api/field-labels?div=slug&type=application|log
 *
 * Public, read-only: returns any per-subdivision overrides Command
 * staff have set for the wording of the "original" fixed fields
 * (Character Name, Discord ID, Badge Number, Rank, and the
 * form-specific content questions) so apply.html/log.html can relabel
 * those fields dynamically. Only overridden fields are returned — the
 * page keeps its own built-in default label for anything not
 * overridden. Fails soft (empty object) if the database isn't set up
 * yet or anything goes wrong — the base form always still works with
 * its default wording.
 */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const div = url.searchParams.get("div");
  const type = url.searchParams.get("type");
  if (!div || !["application", "log"].includes(type) || !env.DB) {
    return jsonResponse({ labels: {} }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT field_key, label FROM field_labels WHERE subdivision_slug = ? AND form_type = ?"
    )
      .bind(div, type)
      .all();
    const labels = {};
    (results || []).forEach((row) => (labels[row.field_key] = row.label));
    return jsonResponse({ labels }, 200);
  } catch {
    return jsonResponse({ labels: {} }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
