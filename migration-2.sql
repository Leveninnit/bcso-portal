-- BCSO Portal — Migration 2 (Cloudflare D1 / SQLite)
--
-- Adds the schema needed for: per-subdivision Rank dropdowns on activity
-- logs, subdivision-scoped Deputy Movement templates, the Discord
-- approve/reject sync (website <-> Discord embed buttons), the
-- per-subdivision "Meet the Team" leadership directory, and the
-- homepage's Deputy of the Week/Month + Patrol Photos sections.
--
-- Run this ONCE against your existing D1 database, the same way you ran
-- schema.sql originally (Cloudflare dashboard -> Workers & Pages -> D1 ->
-- your database -> Console, paste this whole file and execute). It only
-- adds new tables/columns — nothing here touches or deletes existing
-- data.

-- Per-subdivision Rank options for the Activity Log form. If a
-- subdivision has no rows here, log.html keeps the original free-text
-- Rank field — nothing breaks for subdivisions that don't set this up.
-- (RTD is unaffected either way — it already has its own dedicated Rank
-- dropdown wired to the Google Sheet, kept as-is.)
CREATE TABLE IF NOT EXISTS rank_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdivision_slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rank_options_lookup
  ON rank_options (subdivision_slug, sort_order);

-- Subdivision-scoped Deputy Movement templates. NULL subdivision_slug =
-- the original department-wide templates (Suspending/Investigating),
-- unchanged. A template with a subdivision_slug set only shows up on
-- that subdivision's own Movement Templates section in Command Access.
ALTER TABLE movement_templates ADD COLUMN subdivision_slug TEXT;

-- Discord approve/reject sync: lets the admin/submissions endpoint edit
-- the original Discord message when someone accepts/rejects on the
-- website, and lets the Discord interactions endpoint update the
-- database when someone clicks Approve/Reject on the Discord embed.
ALTER TABLE submissions ADD COLUMN discord_message_id TEXT;
ALTER TABLE submissions ADD COLUMN discord_channel_id TEXT;

-- Per-subdivision leadership directory ("Meet the Team" for a single
-- subdivision, e.g. OCD-01/02/03). Editable by that subdivision's own
-- Command Access holders. SRT intentionally has no rows/UI for this —
-- it's excluded department-wide (no public applications, high
-- sensitivity). NRED only ever uses slot 1; OCD/TEU/RTD use 1-3.
CREATE TABLE IF NOT EXISTS subdivision_leadership (
  subdivision_slug TEXT NOT NULL,
  slot_number INTEGER NOT NULL,
  character_name TEXT,
  rank_title TEXT,
  bio TEXT,
  photo_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subdivision_slug, slot_number)
);

INSERT OR IGNORE INTO subdivision_leadership (subdivision_slug, slot_number) VALUES
  ('teu', 1), ('teu', 2), ('teu', 3),
  ('ocd', 1), ('ocd', 2), ('ocd', 3),
  ('rtd', 1), ('rtd', 2), ('rtd', 3),
  ('nred', 1);

-- Small key/value store for homepage content editable by High Command
-- (same isHighCommand gate as the existing Meet the Team roster):
-- Deputy of the Week, Deputy of the Month, and the Patrol Photos
-- gallery. Values are JSON; the API validates their shape.
CREATE TABLE IF NOT EXISTS site_content (
  content_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site_content (content_key, value_json) VALUES
  ('deputy_of_week', '{}'),
  ('deputy_of_month', '{}'),
  ('patrol_photos', '[]');
