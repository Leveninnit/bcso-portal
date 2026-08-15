-- BCSO Portal — full schema (Cloudflare D1 / SQLite)
--
-- Run this once against your D1 database (Cloudflare dashboard →
-- Workers & Pages → D1 → your database → Console, paste this whole file
-- and execute) after you've created the database and bound it to the
-- bcso-portal Pages project as "DB" (Settings → Functions → D1 database
-- bindings → Variable name: DB).
--
-- SETTING UP FRESH: this file is now the complete schema by itself --
-- every table and column that used to be added later by migration-2.sql
-- and migration-4.sql/migration-5.sql/migration-6.sql/migration-7.sql is
-- already included below. You do NOT need to also run
-- migration-2/4/5/6/7 on a brand-new database; just run this file and
-- you're done. (migration-3.sql was never needed at all -- see its own
-- header.)
--
-- UPGRADING AN EXISTING DATABASE that was already set up before this
-- file was updated to include everything: you've presumably already run
-- schema.sql (the old, smaller version) plus some subset of the
-- migration-N.sql files in order. Keep doing that -- re-running this
-- file is harmless (every statement here is IF NOT EXISTS / OR IGNORE)
-- but the migration files remain how you pick up anything you haven't
-- run yet. See each migration file's own header for details.

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdivision_slug TEXT NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('application', 'log')),
  label TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('text', 'paragraph', 'dropdown')),
  options_json TEXT,                     -- JSON array of strings, dropdown only
  required INTEGER NOT NULL DEFAULT 1,   -- 0 or 1
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_lookup
  ON questions (subdivision_slug, form_type, sort_order);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdivision_slug TEXT NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('application', 'log')),
  discord_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  rank TEXT NOT NULL,
  core_fields_json TEXT NOT NULL DEFAULT '{}',  -- e.g. whyJoin/experience or hoursOnDuty/summary
  answers_json TEXT NOT NULL DEFAULT '{}',      -- custom question answers, keyed by question id
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Discord approve/reject sync (originally added by migration-2.sql):
  -- lets the admin/submissions endpoint edit the original Discord message
  -- when someone accepts/rejects on the website, and lets the Discord
  -- interactions endpoint update the database when someone clicks
  -- Approve/Reject on the Discord embed.
  discord_message_id TEXT,
  discord_channel_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_lookup
  ON submissions (subdivision_slug, form_type, status, created_at);

-- Deputy Movement copy-paste templates. NULL subdivision_slug =
-- department-wide (visible/manageable by anyone holding the Command
-- Login role, e.g. the original Suspending/Investigating templates). A
-- template WITH a subdivision_slug (originally added by migration-2.sql)
-- only shows up on that subdivision's own Movement Templates section in
-- Command Access, and only that subdivision's command-role holders can
-- manage it.
CREATE TABLE IF NOT EXISTS movement_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role_ids_json TEXT NOT NULL,           -- JSON array of Discord role ID strings
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  subdivision_slug TEXT
);

CREATE INDEX IF NOT EXISTS idx_movement_templates_lookup
  ON movement_templates (subdivision_slug, sort_order);

INSERT INTO movement_templates (name, role_ids_json, sort_order)
SELECT 'Suspending', '["1283145857176440923"]', 0
WHERE NOT EXISTS (SELECT 1 FROM movement_templates WHERE name = 'Suspending');

INSERT INTO movement_templates (name, role_ids_json, sort_order)
SELECT 'Investigating', '["1285706620374093854"]', 1
WHERE NOT EXISTS (SELECT 1 FROM movement_templates WHERE name = 'Investigating');

-- Per-subdivision overrides for the wording of the "original" fixed
-- fields on the application/log forms (Character Name, Discord ID,
-- Badge Number, Rank, and the form-specific content questions like
-- "Why do you want to join?" or "Shift Summary"). Command staff can
-- reword any of these per subdivision from the Command Access
-- dashboard's "Original Fields" section. If no row exists for a given
-- subdivision/form_type/field_key, the form falls back to its built-in
-- default label — this table only stores the overrides, not every
-- field for every subdivision.
CREATE TABLE IF NOT EXISTS field_labels (
  subdivision_slug TEXT NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('application', 'log')),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subdivision_slug, form_type, field_key)
);

-- Subdivision-specific documents shown on that subdivision's own
-- Documents page (documents.html?div=slug), linked from the Master
-- Documents page's subdivision grid. Command staff holding a
-- subdivision's command role can add, edit, and delete these from the
-- Command Access dashboard's "Documents" tab. Visible to everyone,
-- not just command staff -- same as the rest of the Documents pages.
CREATE TABLE IF NOT EXISTS subdivision_documents (
id INTEGER PRIMARY KEY AUTOINCREMENT,
subdivision_slug TEXT NOT NULL,
name TEXT NOT NULL,
description TEXT NOT NULL DEFAULT '',
url TEXT NOT NULL,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subdivision_documents_lookup
ON subdivision_documents (subdivision_slug, sort_order);

CREATE TABLE IF NOT EXISTS team_roster (
  slot_number INTEGER PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 5),
  character_name TEXT,
  rank_title TEXT,
  subdivision_slug TEXT,
  bio TEXT,
  photo_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO team_roster (slot_number) VALUES (1), (2), (3), (4), (5);

-- Per-subdivision Rank options for the Activity Log form (originally
-- added by migration-2.sql). If a subdivision has no rows here, log.html
-- keeps the original free-text Rank field — nothing breaks for
-- subdivisions that don't set this up. (RTD is unaffected either way —
-- it already has its own dedicated Rank dropdown wired to the Google
-- Sheet, kept as-is.)
--
-- is_activity_exempt (originally added by migration-7.sql): lets that
-- subdivision's own command staff mark a rank as exempt from the
-- Activity column on its public Roster page (roster.html?div=slug) --
-- members holding an exempt rank show "Exempt" instead of an Active /
-- Semi-Active / Inactive rating. Toggled from Command Access -> that
-- subdivision -> Ranks. See functions/api/roster.js.
CREATE TABLE IF NOT EXISTS rank_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdivision_slug TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_activity_exempt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rank_options_lookup
  ON rank_options (subdivision_slug, sort_order);

-- Per-subdivision leadership directory ("Meet the Team" for a single
-- subdivision, e.g. OCD-01/02/03), originally added by migration-2.sql.
-- Editable by that subdivision's own Command Access holders. SRT
-- intentionally has no rows/UI for this — it's excluded department-wide
-- (no public applications, high sensitivity). NRED only ever uses slot
-- 1; OCD/TEU/RTD use 1-3.
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
-- (same isHighCommand gate as the existing Meet the Team roster),
-- originally added by migration-2.sql: Deputy of the Week, Deputy of the
-- Month, and the Patrol Photos gallery. Values are JSON; the API
-- validates their shape.
CREATE TABLE IF NOT EXISTS site_content (
  content_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site_content (content_key, value_json) VALUES
  ('deputy_of_week', '{}'),
  ('deputy_of_month', '{}'),
  ('patrol_photos', '[]');

-- "Roster" feature (originally added by migration-4.sql): every
-- subdivision (including SRT) gets its own roster of members, managed
-- from Command Access and shown on that subdivision's Documents page
-- (documents.html?div=slug). Each entry is just a Rank + Badge Number
-- (+ optional Callsign / Notes) — the member's Character Name and
-- Discord ID are NOT stored here. They're resolved live, at request
-- time, from the Master Roster Google Sheet by badge number (same sheet
-- already used for the Discord-ID-based autofill on the Apply/Log forms
-- — see functions/_lib/roster-sheet.js and functions/api/roster.js), so
-- the roster never goes stale when someone's name changes on the Master
-- Roster.
--
CREATE TABLE IF NOT EXISTS roster_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subdivision_slug TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT '',
  badge_number TEXT NOT NULL DEFAULT '',
  callsign TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_roster_entries_lookup
  ON roster_entries (subdivision_slug, sort_order);

-- Lightweight audit trail (originally added by migration-5.sql),
-- currently used to record who deleted a submission and when, since the
-- deleted row itself no longer exists afterward to answer that question.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_discord_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  subdivision_slug TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_lookup
  ON audit_log (subdivision_slug, created_at);

-- Small generic "who last changed this and when" tracker (originally
-- added by migration-6.sql). Not tied to one table -- content_key
-- identifies whatever was changed: "sop" for the on-site Standard
-- Operating Procedure text (see site_content's 'sop' row, and
-- functions/api/admin/sop.js), or "roster:<slug>" for a given
-- subdivision's Roster (e.g. "roster:teu" -- see roster_entries and
-- functions/api/admin/roster.js). One row per content_key, overwritten
-- on every edit -- this only ever answers "who touched this LAST", not
-- a full history (see audit_log above for that).
CREATE TABLE IF NOT EXISTS content_meta (
  content_key TEXT PRIMARY KEY,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
