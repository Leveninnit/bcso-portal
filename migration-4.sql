-- BCSO Portal — Migration 4 (Cloudflare D1 / SQLite)
--
-- Adds the "Roster" feature: every subdivision (including SRT) gets its
-- own roster of members, managed from Command Access and shown on that
-- subdivision's Documents page (documents.html?div=slug). Each entry is
-- just a Rank + Badge Number (+ optional Callsign / Notes) — the
-- member's Character Name and Discord ID are NOT stored here. They're
-- resolved live, at request time, from the Master Roster Google Sheet
-- by badge number (same sheet already used for the Discord-ID-based
-- autofill on the Apply/Log forms — see functions/_lib/roster-sheet.js
-- and functions/api/roster.js), so the roster never goes stale when
-- someone's name changes on the Master Roster.
--
-- Run this once against your D1 database (Cloudflare dashboard ->
-- Workers & Pages -> your Pages project -> D1 -> your database ->
-- Console, paste this whole file and execute).

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
