-- BCSO Portal — Migration 6 (Cloudflare D1 / SQLite)
--
-- SKIP THIS FILE if you're setting up a brand-new database: schema.sql
-- was updated to already include the content_meta table below. Just run
-- schema.sql and you're done. This file is only for a database set up
-- before that consolidation that hasn't run this migration yet.
--
-- Adds content_meta: a small generic "who last changed this and when"
-- tracker. It powers the "Last updated ... by ..." line now shown on
-- the on-site Standard Operating Procedure page (sop.html, content_key
-- "sop") and on each subdivision's Roster page (roster.html?div=slug,
-- content_key "roster:<slug>", e.g. "roster:teu"). One row per
-- content_key, overwritten on every edit -- it only ever answers "who
-- touched this LAST", not a full history (see audit_log for that).
--
-- Also required for the on-site SOP editor to work at all: it reuses
-- the existing site_content table (a new row with content_key = 'sop'),
-- which already exists from schema.sql/migration-2.sql, so no change is
-- needed there.
--
-- Run this once against your D1 database (Cloudflare dashboard ->
-- Workers & Pages -> your Pages project -> D1 -> your database ->
-- Console, paste this whole file and execute).

CREATE TABLE IF NOT EXISTS content_meta (
  content_key TEXT PRIMARY KEY,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
