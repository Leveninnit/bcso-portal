/**
 * Shared helper for the content_meta table -- a small generic "who last
 * changed this and when" tracker used by content that's edited in place
 * on the site rather than going through the applications/logs review
 * flow: the on-site SOP (content_key "sop") and each subdivision's
 * Roster (content_key "roster:<slug>"). See schema.sql / migration-6.sql
 * for the table itself.
 *
 * Both helpers are best-effort and fail soft (return/resolve without
 * throwing) -- "who last touched this" is a nice-to-have shown next to
 * the real content, and a hiccup reading or writing it should never
 * break the SOP/Roster read or write it's attached to.
 */

export async function touchContentMeta(env, contentKey, updatedBy) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO content_meta (content_key, updated_by, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(content_key) DO UPDATE SET updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(contentKey, (updatedBy || "Unknown").toString().slice(0, 100))
      .run();
  } catch (err) {
    console.error(`Failed to update content_meta for "${contentKey}":`, err);
  }
}

/** Returns { by, at } or null if never recorded / DB unavailable / on error. */
export async function getContentMeta(env, contentKey) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT updated_by, updated_at FROM content_meta WHERE content_key = ?"
    )
      .bind(contentKey)
      .first();
    if (!row) return null;
    return { by: row.updated_by, at: row.updated_at };
  } catch (err) {
    console.error(`Failed to read content_meta for "${contentKey}":`, err);
    return null;
  }
}
