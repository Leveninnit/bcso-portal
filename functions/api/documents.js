/**
 * Cloudflare Pages Function
 * GET /api/documents?div=slug
 *
 * Public, read-only: returns the documents a subdivision's command
 * staff have added for their own Documents page (documents.html?div=slug),
 * listed below the master, department-wide documents. Fails soft
 * (empty list) if the database isn't set up yet or anything goes
 * wrong -- the page still works, it just shows no documents.
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
if (!div || !env.DB) {
return jsonResponse({ documents: [] }, 200);
}
try {
const { results } = await env.DB.prepare(
"SELECT id, name, description, url FROM subdivision_documents WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
)
.bind(div)
.all();
return jsonResponse({ documents: results || [] }, 200);
} catch {
return jsonResponse({ documents: [] }, 200);
}
}
export async function onRequestPost() {
return jsonResponse({ error: "Method not allowed. Use GET." }, 405);
}
