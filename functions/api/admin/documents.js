/**
 * Cloudflare Pages Function
 * /api/admin/documents
 *
 * Lets a subdivision's command-role holders manage the documents shown
 * on that subdivision's own Documents page (documents.html?div=slug),
 * linked from the Master Documents page's subdivision grid.
 *
 * GET ?div=slug -> list documents
 * POST { subdivisionSlug, name, description, url, sortOrder } -> create
 * PUT { id, subdivisionSlug, name, description, url, sortOrder } -> update
 * DELETE ?id=..&div=slug -> remove
 *
 * Every write requires a valid Command Access session for that exact
 * subdivision -- someone with only the RTD command role cannot touch
 * TEU's documents, for example.
 *
 * Requires the D1 database bound as "DB" (Settings -> Functions -> D1
 * database bindings in the Cloudflare Pages dashboard).
 */
import { requireSession } from "../../_lib/auth-guard.js";

function jsonResponse(body, status) {
return new Response(JSON.stringify(body), {
status,
headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
}
function parseDocument(row) {
return {
id: row.id,
subdivisionSlug: row.subdivision_slug,
name: row.name,
description: row.description,
url: row.url,
sortOrder: row.sort_order,
};
}
function validDocumentShape(body) {
return (
body &&
typeof body.name === "string" &&
body.name.trim() &&
typeof body.url === "string" &&
/^https?:\/\//i.test(body.url.trim())
);
}

export async function onRequestGet(context) {
const { request, env } = context;
if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
const url = new URL(request.url);
const div = url.searchParams.get("div");
if (!div) return jsonResponse({ error: "div is required." }, 400);
const session = await requireSession(request, env, div);
if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

const { results } = await env.DB.prepare(
"SELECT * FROM subdivision_documents WHERE subdivision_slug = ? ORDER BY sort_order ASC, id ASC"
)
.bind(div)
.all();
return jsonResponse({ documents: results.map(parseDocument) }, 200);
}

export async function onRequestPost(context) {
const { request, env } = context;
if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
const body = await request.json().catch(() => null);
if (!body || !body.subdivisionSlug || !validDocumentShape(body)) {
return jsonResponse({ error: "Missing or invalid fields." }, 400);
}
const session = await requireSession(request, env, body.subdivisionSlug);
if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

await env.DB.prepare(
`INSERT INTO subdivision_documents (subdivision_slug, name, description, url, sort_order)
VALUES (?, ?, ?, ?, ?)`
)
.bind(
body.subdivisionSlug,
body.name.trim().slice(0, 200),
(body.description || "").trim().slice(0, 500),
body.url.trim().slice(0, 500),
Number.isFinite(body.sortOrder) ? body.sortOrder : 0
)
.run();

return jsonResponse({ ok: true }, 200);
}

export async function onRequestPut(context) {
const { request, env } = context;
if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
const body = await request.json().catch(() => null);
if (!body || !body.id || !body.subdivisionSlug || !validDocumentShape(body)) {
return jsonResponse({ error: "Missing or invalid fields." }, 400);
}
const session = await requireSession(request, env, body.subdivisionSlug);
if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

await env.DB.prepare(
`UPDATE subdivision_documents
SET name = ?, description = ?, url = ?, sort_order = ?, updated_at = datetime('now')
WHERE id = ? AND subdivision_slug = ?`
)
.bind(
body.name.trim().slice(0, 200),
(body.description || "").trim().slice(0, 500),
body.url.trim().slice(0, 500),
Number.isFinite(body.sortOrder) ? body.sortOrder : 0,
body.id,
body.subdivisionSlug
)
.run();

return jsonResponse({ ok: true }, 200);
}

export async function onRequestDelete(context) {
const { request, env } = context;
if (!env.DB) return jsonResponse({ error: "Database not configured yet." }, 500);
const url = new URL(request.url);
const id = url.searchParams.get("id");
const div = url.searchParams.get("div");
if (!id || !div) return jsonResponse({ error: "id and div are required." }, 400);
const session = await requireSession(request, env, div);
if (!session) return jsonResponse({ error: "Unauthorized." }, 401);

await env.DB.prepare("DELETE FROM subdivision_documents WHERE id = ? AND subdivision_slug = ?")
.bind(id, div)
.run();
return jsonResponse({ ok: true }, 200);
}
