# Blaine County Sheriff's Office — Department Portal

A free, no-login-required-for-visitors portal for your FiveM PD: a home
page, a subdivision directory (TEU, OCD, SRT, NRED, RTD) with
application forms, a subdivision activity log, a Master Documents page
(roster + SOP), and a Discord-gated **Command Access** dashboard for
command staff. Applications and activity logs post a formatted message
straight into Discord via webhook (and ping the right people), and can
auto-fill a member's name/badge/rank from your Master Roster Google
Sheet by Discord ID. No always-on backend server to run — it deploys
as a static site plus a set of small serverless functions (Cloudflare
Pages Functions) and a Cloudflare D1 database, all on Cloudflare's free
tier.

## Status

This repo and its Cloudflare Pages deployment were set up for you
already. A few things are left for you to do (on purpose — see below):
1. Share the Master Roster sheet and SOP doc so the portal can read/link them.
2. Add your Discord webhook(s) and roster sheet ID as Cloudflare environment variables.
3. Set up Command Access: create a Discord OAuth app + bot, create a D1 database, and add the related environment variables (see the **Command Access** section below).

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

Your webhook URLs, bot token, and OAuth client secret are all
credentials — anyone who has one can post fake messages into your
Discord (or worse), so none of them should ever be pasted into a chat
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
   | `DISCORD_WEBHOOK_TEU`, `_OCD`, `_SRT`, `_NRED`, `_RTD` | Per-subdivision **application** webhooks (SRT has no application form, so `DISCORD_WEBHOOK_SRT` is never used) | Optional |
   | `DISCORD_WEBHOOK_TEU_LOG`, `_OCD_LOG`, `_SRT_LOG`, `_NRED_LOG`, `_RTD_LOG` | Per-subdivision **activity log** webhooks, if you want each subdivision's logs in its own channel | Optional |
   | `ROSTER_SHEET_ID` | `16OWSECFEZRnVMApFN3ohJzZ3rYDZ55gQTZUjwGtCyN4` | Yes, for the auto-fill feature |
   | `ROSTER_SHEET_GID` | `400362246` (the Employee Database tab) | Yes, for the auto-fill feature |
   | `DISCORD_CLIENT_ID` | Your Discord application's Client ID | Yes, for Command Access login |
   | `DISCORD_CLIENT_SECRET` | Your Discord application's Client Secret | Yes, for Command Access login |
   | `DISCORD_BOT_TOKEN` | Your Discord bot's token | Yes, for Command Access login (used to look up a member's roles) |
   | `SESSION_SECRET` | Any long random string you make up yourself (e.g. generate one with `openssl rand -hex 32`) | Yes, for Command Access login |

   Per-subdivision webhooks always take priority over the shared
   fallback for that one subdivision; everything else still uses the
   fallback. Applications and activity logs are completely separate —
   you can send them to different channels, or reuse the same webhook
   URL for both if you'd rather they land in one place.

3. Click **Save**, then go to **Deployments** → redeploy the latest
   deployment (or just push any small change to GitHub) so the
   functions pick up the new variables.

That's it — submit a test application or activity log on your live
site and you should see it land in Discord within a second or two
(pinging the subdivision's command role and the submitter), and typing
a real Discord ID into the Discord field should auto-fill the character
name, badge number, and rank from the Master Roster.

## Command Access (staff dashboard)

`command-access.html` is a dashboard for anyone holding the **Command
Login** Discord role. After signing in with Discord, it shows a tab
per subdivision the person holds a command role for, and lets them:

- Review pending applications and activity logs, and accept, reject,
  or permanently delete each one (accepting/rejecting never sends an
  automatic DM — command staff are expected to follow up on Discord
  themselves).
- Customize that subdivision's extra application/log questions: add
  text, paragraph, or dropdown questions, reorder them, mark them
  required/optional, edit dropdown options, or delete them. These
  questions appear automatically underneath the fixed fields on the
  live `apply.html`/`log.html` forms for that subdivision.

**SRT is log-only** — by design it has no public application form (see
`assets/subdivisions.js`, `logOnly: true`), so its Command Access tab
only shows an Activity Log, no Applications tab.

### Setting up Command Access

1. **Create a Discord application** at https://discord.com/developers/applications
   → **New Application**. Under **OAuth2** → **General**, copy the
   **Client ID** and **Client Secret** (these become `DISCORD_CLIENT_ID`
   / `DISCORD_CLIENT_SECRET` above). Add a redirect URL:
   `https://<your-site>/api/auth/callback`.
2. Under **Bot**, create a bot and copy its **token** (this becomes
   `DISCORD_BOT_TOKEN`). Enable the **Server Members Intent**. Invite
   the bot to your server with at least permission to view members
   (no other permissions are required — it never posts messages;
   webhooks handle that separately).
3. Create a Discord role called (or repurposed as) **Command Login**
   and give it to anyone who should be able to open the dashboard at
   all. Give each subdivision's command staff their subdivision's
   command role too (see `SUBDIVISION_COMMAND_ROLES` in
   `functions/_lib/discord.js` for the role-ID mapping — add a line
   there if a new subdivision gets its own command role later). None
   of these role/server/user IDs are secret — anyone with Developer
   Mode in Discord can already see them by right-clicking, so it's
   fine that they're committed in this repo.
4. Pick your own `SESSION_SECRET` (any long random string) and add all
   four variables from the table above in Cloudflare.
5. **Create a D1 database**: Cloudflare dashboard → **Workers & Pages**
   → **D1** → **Create database** (any name, e.g. `bcso-portal-db`).
   Open its **Console** tab, paste in the entire contents of
   `schema.sql` from this repo, and run it — this creates the
   `questions` and `submissions` tables.
6. **Bind the database to the Pages project**: your `bcso-portal`
   project → **Settings** → **Functions** → **D1 database bindings** →
   **Add binding** → Variable name **`DB`**, select the database you
   just created → **Save**.
7. Redeploy (push any small change, or redeploy the latest deployment
   from the **Deployments** tab) so the functions pick up the new
   binding and environment variables.

Once that's done, anyone with the Command Login role can sign in at
`command-access.html` (linked from the main nav) via **Login with
Discord**.

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
  // logOnly: true,          // uncomment if this subdivision should have
                              // no public application form (see SRT)
},
```

Push the change to GitHub — Cloudflare redeploys automatically in
under a minute. The Applications page, Activity Log page, and both
forms all pick up the new subdivision with no other edits needed. If
the new subdivision should have its own Command Access tab, also add
its command role ID to `SUBDIVISION_COMMAND_ROLES` in
`functions/_lib/discord.js`.

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
only falls back to the shared webhook if none exists. Every message's
`content` field also pings that subdivision's command role and the
submitter directly (via `allowed_mentions`, never via the embed), so
command staff and the applicant both get notified.

## Project structure

```
index.html                    Home page
documents.html                 Master Documents page (roster, SOP, ...)
applications.html              Subdivision directory -> apply.html (excludes log-only subdivisions)
apply.html                     Application form (reads ?div=slug from the URL)
activity-log.html               Subdivision directory -> log.html
log.html                        Activity log form (reads ?div=slug from the URL)
command-access.html             Command staff dashboard (Discord login required)
assets/
  style.css                     Theme (dark green / gold / silver)
  main.js                       Shared header/footer + nav links
  subdivisions.js                Single source of truth for subdivisions
  documents.js                   Single source of truth for Master Documents
  apply.js                       Application form logic + submits to /api/apply
  log.js                         Activity log form logic + submits to /api/log
  command-access.js              Command Access dashboard logic
  command-access.css             Command Access dashboard styles
  bcso-crest.png                 Your department crest (used as logo/favicon)
functions/
  _lib/
    discord.js                   Shared Discord config (role IDs) + OAuth/bot API helpers
    session.js                   Signed-cookie session helpers
    auth-guard.js                 Per-request "does this session command this subdivision?" check
  api/
    apply.js                     Validates + forwards applications to Discord, saves to D1
    log.js                       Validates + forwards activity logs to Discord, saves to D1
    roster-lookup.js              Looks up one member by Discord ID in the Master Roster
    questions.js                  Public, read-only: extra questions for a subdivision's form
    auth/
      login.js                    Redirects to Discord's OAuth authorize screen
      callback.js                  Exchanges the OAuth code, checks roles, issues a session cookie
      logout.js                    Clears the session cookie
      me.js                        Returns the current session's login state + subdivisions
    admin/
      questions.js                 GET/POST/PUT/DELETE for a subdivision's custom questions (auth-gated)
      submissions.js               GET/PATCH/DELETE for a subdivision's applications/logs (auth-gated)
schema.sql                     D1 schema for the questions/submissions tables (run once, see above)
```

## Anti-spam built in

- A hidden honeypot field silently ignores bots that fill in every
  input, on both the application and activity log forms.
- Submissions faster than 3 seconds after the page loads are treated
  as automated and silently dropped (a real person can't read the
  form and type that fast).
- `allowed_mentions` on every Discord message allowlists only the
  intended command role and submitter, so nobody can smuggle an
  `@everyone` ping through a text field.
- All fields are length-capped before being sent to Discord.
- Command Access endpoints all re-check the requester's Discord roles
  against the live server membership on every request (via the bot
  token), not just at login — losing a command role revokes dashboard
  access immediately, not just at next login.

None of this requires a paid plan — it all runs on Cloudflare's free
tier (unlimited static bandwidth, 100,000 free function calls/day, and
D1's free tier of 5GB storage / 5 million rows read per day, which is
far more than this portal will ever need).

## Local preview (optional)

If you install Node and want to preview before deploying:

```
npm install -g wrangler
wrangler pages dev .
```

This runs the site *and* the `/api/*` functions locally at
`http://localhost:8788`. You'll need to pass the environment variables
above via `wrangler pages dev . --binding NAME=value` for each one (or
a local `.dev.vars` file — never commit that file), and bind a local
D1 database with `--d1 DB=<database-name>` for the Command Access
functions to work locally.

There's also a plain-Node test harness for each function (no wrangler
needed) under `test/` — run `node test/test-apply.mjs`,
`node test/test-log.mjs`, and `node test/test-roster-lookup.mjs`.
