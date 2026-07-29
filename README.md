# Blaine County Sheriff's Office — Department Portal

A free, no-login portal for your FiveM PD: a home page, a subdivision
directory (TEU, OCD, NRED, RTD) with application forms, a subdivision
activity log, and a Master Documents page (roster + SOP). Applications
and activity logs post a formatted embed straight into Discord via
webhook, and can auto-fill a member's name/badge/rank from your Master
Roster Google Sheet by Discord ID. No backend server to run — it
deploys as a static site plus a few small serverless functions that
keep your webhook URLs and sheet ID private.

## Status

This repo and its Cloudflare Pages deployment were set up for you
already. Two things are left for you to do (on purpose — see below):
1. Share the Master Roster sheet and SOP doc so the portal can read/link them.
2. Add your Discord webhook(s) and roster sheet ID as Cloudflare environment variables.

## 1. Share the Master Roster sheet and SOP doc

Two Google files are linked from the portal (`assets/documents.js`) and
one of them (the Master Roster) is also read by the auto-fill feature.
Both need to be shared as **"Anyone with the link — Viewer"**:

1. Open the [Master Roster sheet](https://docs.google.com/spreadsheets/d/16OWSECFEZRnVMApFN3ohJzZ3rYDZ55gQTZUjwGtCyN4/edit) → **Share** (top right) → under
   **General access**, change from "Restricted" to **"Anyone with the
   link"**, role **Viewer** → **Done**.
2. Do the same for the [SOP doc](https://docs.google.com/document/d/10-1E-G905Fn8XPIelmPafbPlazCWHSQxwLTzlYTek5U/edit).

Only the specific server-side function that reads the roster (see
below) ever sees the sheet's export URL — it's stored as a Cloudflare
secret, never committed to this repo, so casual visitors to the portal
can't find it just by viewing the page source. The Master Roster link
on the Master Documents page is, by design, visible to anyone who opens
that page — that's the point of sharing it "anyone with the link."

## 2. Add your Discord webhook(s) and the roster sheet ID

Your webhook URLs are credentials — anyone who has one can post fake
messages into your Discord, so they should never be pasted into a chat
with anyone, including an AI assistant. Add everything directly in
Cloudflare:

1. Go to https://dash.cloudflare.com/ → **Workers & Pages** → your
   `bcso-portal` project → **Settings** → **Environment variables**.
2. Under **Production**, click **Add variable** for each of the
   following (click **Encrypt** on each one so it's stored as a secret):

   | Name | Value | Required? |
   |---|---|---|
   | `DISCORD_WEBHOOK_URL` | Your applications webhook (fallback for all subdivisions) | Yes |
   | `DISCORD_WEBHOOK_LOG` | Your activity-log webhook (fallback for all subdivisions) | Yes, if you want activity logging to work |
   | `DISCORD_WEBHOOK_TEU`, `_OCD`, `_NRED`, `_RTD` | Per-subdivision **application** webhooks, if you want each subdivision's applications in its own channel | Optional |
   | `DISCORD_WEBHOOK_TEU_LOG`, `_OCD_LOG`, `_NRED_LOG`, `_RTD_LOG` | Per-subdivision **activity log** webhooks, if you want each subdivision's logs in its own channel | Optional |
   | `ROSTER_SHEET_ID` | `16OWSECFEZRnVMApFN3ohJzZ3rYDZ55gQTZUjwGtCyN4` | Yes, for the auto-fill feature |
   | `ROSTER_SHEET_GID` | `400362246` (the Employee Database tab) | Yes, for the auto-fill feature |

   Per-subdivision webhooks always take priority over the shared
   fallback for that one subdivision; everything else still uses the
   fallback. Applications and activity logs are completely separate —
   you can send them to different channels, or reuse the same webhook
   URL for both if you'd rather they land in one place.

3. Click **Save**, then go to **Deployments** → redeploy the latest
   deployment (or just push any small change to GitHub) so the
   functions pick up the new variables.

That's it — submit a test application or activity log on your live
site and you should see it land in Discord within a second or two, and
typing a real Discord ID into the Discord field should auto-fill the
character name, badge number, and rank from the Master Roster.

## Adding more subdivisions later

Open `assets/subdivisions.js` and add one object to the `SUBDIVISIONS`
array:

```js
{
  slug: "swat",              // used in the URL: apply.html?div=swat
  name: "SWAT",
  short: "SWAT",
  description: "...",
  requirements: ["...", "..."],
},
```

Push the change to GitHub — Cloudflare redeploys automatically in
under a minute. The Applications page, Activity Log page, and both
forms all pick up the new subdivision with no other edits needed.

## Adding more Master Documents later

Open `assets/documents.js` and add one object to the `DOCUMENTS` array
with a `name`, `description`, and `url`. The Master Documents page
picks it up automatically. Remember to share any new Google Doc/Sheet
as "Anyone with the link — Viewer" or visitors won't be able to open it.

## How the Master Roster auto-fill works

When someone types a Discord ID into the Discord Username field on the
Applications or Activity Log form and clicks/tabs away, the page calls
`/api/roster-lookup?discordId=...`. That function (server-side, never
visible to the browser) fetches the **Employee Database** tab of your
Master Roster as CSV, looks for a row whose Discord ID matches, and
returns just that person's name, badge number, and rank — never the
whole roster. If there's no match (new recruit not in the roster yet,
roster not shared/configured, etc.), the fields are simply left blank
for manual entry; nothing blocks submission.

The lookup matches columns by name, not position, so you can reorder
columns in the sheet without breaking anything — it just needs columns
named (case-insensitive) something containing "discord", "name",
"badge", and "rank" in the Employee Database tab.

## Routing a subdivision to a different Discord channel (optional)

By default every application goes to `DISCORD_WEBHOOK_URL` and every
activity log goes to `DISCORD_WEBHOOK_LOG`. To send one specific
subdivision's applications or logs to a different channel, add another
environment variable in Cloudflare:

- Applications: `DISCORD_WEBHOOK_<SLUG>` (uppercase), e.g. `DISCORD_WEBHOOK_SWAT`.
- Activity logs: `DISCORD_WEBHOOK_<SLUG>_LOG`, e.g. `DISCORD_WEBHOOK_SWAT_LOG`.

Each function checks for its own per-subdivision override first and
only falls back to the shared webhook if none exists.

## Project structure

```
index.html                    Home page
documents.html                 Master Documents page (roster, SOP, ...)
applications.html              Subdivision directory -> apply.html
apply.html                     Application form (reads ?div=slug from the URL)
activity-log.html               Subdivision directory -> log.html
log.html                        Activity log form (reads ?div=slug from the URL)
assets/
  style.css                     Theme (dark green / gold / silver)
  main.js                       Shared header/footer + nav links
  subdivisions.js                Single source of truth for subdivisions
  documents.js                   Single source of truth for Master Documents
  apply.js                       Application form logic + submits to /api/apply
  log.js                         Activity log form logic + submits to /api/log
  bcso-crest.png                 Your department crest (used as logo/favicon)
functions/api/apply.js          Serverless function: validates + forwards applications to Discord
functions/api/log.js            Serverless function: validates + forwards activity logs to Discord
functions/api/roster-lookup.js  Serverless function: looks up one member by Discord ID in the Master Roster
```

## Anti-spam built in

- A hidden honeypot field silently ignores bots that fill in every
  input, on both the application and activity log forms.
- Submissions faster than 3 seconds after the page loads are treated
  as automated and silently dropped (a real person can't read the
  form and type that fast).
- `allowed_mentions: { parse: [] }` on every Discord message means
  nobody can smuggle an `@everyone` ping through a text field.
- All fields are length-capped before being sent to Discord.

None of this requires a database, login system, or paid plan — it all
runs on Cloudflare's free tier (unlimited static bandwidth, 100,000
free function calls/day, which is far more than this portal will ever
need).

## Local preview (optional)

If you install Node and want to preview before deploying:

```
npm install -g wrangler
wrangler pages dev .
```

This runs the site *and* the `/api/*` functions locally at
`http://localhost:8788`. You'll need to pass the environment variables
above via `wrangler pages dev . --binding NAME=value` for each one (or
a local `.dev.vars` file — never commit that file).

There's also a plain-Node test harness for each function (no wrangler
needed) under `test/` — run `node test/test-apply.mjs`,
`node test/test-log.mjs`, and `node test/test-roster-lookup.mjs`.
