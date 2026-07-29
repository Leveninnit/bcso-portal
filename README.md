# Blaine County Sheriff's Office — Applications Portal

A free, no-login portal for your FiveM PD: a home page, a subdivision
directory (TEU, OCD, NRED, RTD), and application forms that post a
formatted embed straight into a Discord channel via webhook. No backend
server to run — it deploys as a static site plus one small serverless
function that keeps your webhook URL private.

## Status

This repo and its Cloudflare Pages deployment were set up for you already.
The only step left is yours to do (on purpose — see below): pasting your
Discord webhook URL into Cloudflare's environment variables.

## The one step you need to do: add your Discord webhook

Your webhook URL is a credential — anyone who has it can post fake
messages into your Discord, so it should never be pasted into a chat
with anyone, including an AI assistant. Add it directly in Cloudflare:

1. Go to https://dash.cloudflare.com/ → **Workers & Pages** → your
   `bcso-portal` project → **Settings** → **Environment variables**.
2. Under **Production**, click **Add variable**.
3. Name: `DISCORD_WEBHOOK_URL`
   Value: *(paste your webhook URL)*
   Click the **Encrypt** checkbox so it's stored as a secret.
4. Click **Save**, then go to **Deployments** → redeploy the latest
   deployment (or just push any small change to GitHub) so the function
   picks up the new variable.

That's it — submit a test application on your live site and you should
see it land in Discord within a second or two.

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
under a minute. The Applications page and the form both pick up the
new subdivision with no other edits needed.

## Routing a subdivision to a different Discord channel (optional)

By default every application goes to `DISCORD_WEBHOOK_URL`. To send one
specific subdivision's applications to a different channel/webhook,
add another environment variable in Cloudflare named
`DISCORD_WEBHOOK_<SLUG>` (uppercase), e.g. `DISCORD_WEBHOOK_SWAT`. The
function checks for a per-subdivision override first and only falls
back to the shared webhook if none exists.

## Project structure

```
index.html              Home page
applications.html       Subdivision directory
apply.html              Application form (reads ?div=slug from the URL)
assets/
  style.css              Theme (dark green / gold / silver)
  main.js                Shared header/footer + nav links
  subdivisions.js        Single source of truth for subdivisions
  apply.js               Form logic + submits to /api/apply
  bcso-crest.png         Your department crest (used as logo/favicon)
functions/api/apply.js   Serverless function: validates + forwards to Discord
```

## Anti-spam built in

- A hidden honeypot field silently ignores bots that fill in every
  input.
- Submissions faster than 3 seconds after the page loads are treated
  as automated and silently dropped (a real applicant can't read the
  form and type that fast).
- `allowed_mentions: { parse: [] }` on every Discord message means
  nobody can smuggle an `@everyone` ping through a text field.
- All fields are length-capped before being sent to Discord.

None of this requires a database, login system, or paid plan — it all
runs on Cloudflare's free tier (unlimited static bandwidth, 100,000
free function calls/day, which is far more than an applications form
will ever need).

## Local preview (optional)

If you install Node and want to preview before deploying:

```
npm install -g wrangler
wrangler pages dev .
```

This runs the site *and* the `/api/apply` function locally at
`http://localhost:8788`. You'll need to pass `DISCORD_WEBHOOK_URL` via
`wrangler pages dev . --binding DISCORD_WEBHOOK_URL=<your-webhook>` (or
a local `.dev.vars` file — never commit that file).
