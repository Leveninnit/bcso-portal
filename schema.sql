-- BCSO Portal — Command Access schema (Cloudflare D1 / SQLite)
--
-- Run this once against your D1 database (Cloudflare dashboard →
-- Workers & Pages → D1 → your database → Console, paste this whole file
-- and execute) after you've created the database and bound it to the
-- bcso-portal Pages project as "DB" (Settings → Functions → D1 database
-- bindings → Variable name: DB).

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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_submissions_lookup
  ON submissions (subdivision_slug, form_type, status, created_at);

-- Deputy Movement copy-paste templates (department-wide, not tied to a
-- single subdivision — anyone holding the Command Login role can view
-- and use these, and can add more from the dashboard's "Customize
-- Templates" tab under Deputy Movement).
CREATE TABLE IF NOT EXISTS movement_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role_ids_json TEXT NOT NULL,           -- JSON array of Discord role ID strings
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
