/**
 * Cloudflare Pages Function
 * GET /api/questions?div=slug&type=application|log
 *
 * Public, read-only: returns the extra custom questions Command staff
 * have configured for a subdivision's application or activity log
 * form, so apply.html/log.html can render them dynamically underneath
 * the fixed identity fields. Fails soft (empty list) if the database
 * isn't set up yet or anything goes wrong — the base form always still
 * works without custom questions.
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
    return jsonResponse({ questions: [] }, 200);
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM questions WHERE subdivision_slug = ? AND form_type = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(div, type)
      .all();
    return jsonResponse(
      {
        questions: results.map((row) => ({
          id: row.id,
          label: row.label,
          questionType: row.question_type,
          options: row.options_json ? JSON.parse(row.options_json) : [],
          required: !!row.required,
        })),
      },
      200
    );
  } catch {
    return jsonResponse({ questions: [] }, 200);
  }
}
export async function onRequestPost() {
  return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
