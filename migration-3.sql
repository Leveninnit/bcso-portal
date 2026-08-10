-- BCSO Portal — Migration 3 (Cloudflare D1 / SQLite)
--
-- Adds an optional fixed "wording" to Deputy Movement templates, e.g. a
-- template named "Suspending" could carry the wording "is being
-- suspended pending investigation" — that text is included automatically
-- in every message generated from that template, on top of whatever
-- notes/Approved By the person generating the message adds themselves.
--
-- Run this ONCE against your existing D1 database (Cloudflare dashboard
-- -> Workers & Pages -> your D1 database -> Console, paste this whole
-- file and execute) — the same way you ran schema.sql and migration-2.sql.
-- If you haven't run migration-2.sql yet, run that one first; this file
-- only adds one column to a table migration-2.sql already touched.

ALTER TABLE movement_templates ADD COLUMN wording TEXT;
