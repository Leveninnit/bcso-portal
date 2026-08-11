-- BCSO Portal — Migration 5 (Cloudflare D1 / SQLite)
--
-- SKIP THIS FILE if you're setting up a brand-new database: schema.sql
-- was updated to already include the audit_log table and index below.
-- Just run schema.sql and you're done. This file is only for a database
-- set up before that consolidation that hasn't run this migration yet.
--
-- Adds a lightweight audit_log table, currently used to record who
-- deleted a submission (application/log) and when, since the deleted
-- row itself no longer exists afterward to answer that question. Not
-- tied to a single table long-term — "action" + "detail_json" are
-- generic enough to log other destructive actions here later if needed.
-- Also adds an index on movement_templates.subdivision_slug, which was
-- always queried by (see functions/api/admin/movement-templates.js) but
-- never had one.
--
-- Run this once against your D1 database (Cloudflare dashboard ->
-- Workers & Pages -> your Pages project -> D1 -> your database ->
-- Console, paste this whole file and execute).

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

CREATE INDEX IF NOT EXISTS idx_movement_templates_lookup
  ON movement_templates (subdivision_slug, sort_order);
