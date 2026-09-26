# Sheet-sync runbook — phone-friendly setup

What this gives you: edit the restaurant corpus in a private Google Sheet from your
phone. Twice a day, a robot notices the sheet changed, dry-runs the import, and sends
you a WhatsApp message with a summary and one link. Tap **Approve** and the real
import runs (and the database is pruned to match the sheet exactly); tap **Deny** and
nothing happens. Everything below is one-time setup, done from a phone browser is
fine for most of it.

## 1. Google Cloud service account (read-only access to the sheet)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a
   project (or use an existing one).
2. **APIs & Services -> Library** -> search "Google Sheets API" -> **Enable**.
3. **APIs & Services -> Credentials -> Create Credentials -> Service account.** Give
   it any name (e.g. `kashroot-sheet-sync`). No roles needed at the project level.
4. Open the new service account -> **Keys -> Add key -> Create new key -> JSON.**
   Downloads a `.json` file — this is `KASHROOT_GOOGLE_SERVICE_ACCOUNT_JSON`. Treat it
   as a secret.
5. Note the service account's email (looks like
   `kashroot-sheet-sync@<project>.iam.gserviceaccount.com`).
6. Open your Google Sheet -> **Share** -> paste that email -> give it **Viewer**
   access (not Editor — this pipeline only ever reads). Copy the sheet's id from its
   URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
7. Note the tab name at the bottom of the sheet you want imported (e.g. `Sheet1`).

## 2. Twilio WhatsApp

**Sandbox (fastest, for trying it out):**

1. Sign up at [twilio.com](https://www.twilio.com), open **Messaging -> Try it out ->
   Send a WhatsApp message.** Follow the "join <code>" instructions from your own
   WhatsApp to the sandbox number — this opens the 24-hour window so a freeform
   message can reach you.
2. Note your **Account SID** and **Auth Token** (Console dashboard).
3. `KASHROOT_TWILIO_WHATSAPP_FROM` = the sandbox number, formatted
   `whatsapp:+14155238886`. `KASHROOT_WHATSAPP_TO` = your own number, formatted
   `whatsapp:+972501234567`.
4. Leave `KASHROOT_TWILIO_CONTENT_SID` unset — freeform `Body` works in the sandbox.

**Production sender (once the twice-daily cron needs to reach you outside that 24h
window — it will, since nobody messages the bot back on a schedule):**

1. Apply for **WhatsApp Business** access under **Messaging -> Senders** and connect
   a real number.
2. Under **Content Editor**, create a Content Template with two variables — one for
   the summary text, one for the confirm link — and submit it for WhatsApp approval
   (takes anywhere from minutes to a couple of days).
3. Once approved, set `KASHROOT_TWILIO_CONTENT_SID` to the template's `HX...` id.
   With this set, every sheet-sync message uses the template instead of a freeform
   body, which works any time, not just inside the 24h window.

## 3. GitHub PAT for Render to trigger the apply workflow

1. GitHub -> your avatar -> **Settings -> Developer settings -> Personal access
   tokens -> Fine-grained tokens -> Generate new token.**
2. **Repository access:** "Only select repositories" -> this repo only.
3. **Permissions:** Repository permissions -> **Actions: Read and write.** Nothing
   else is needed.
4. Copy the token — this is `KASHROOT_GITHUB_DISPATCH_TOKEN`. It only lets Render
   trigger/read Actions runs on this one repo, nothing more.

## 4. Where each value goes

**GitHub repo secrets** (Settings -> Secrets and variables -> Actions -> New repository
secret) — read by both workflows:

| Secret | Value |
|---|---|
| `KASHROOT_DATABASE_URL` | Supabase **session pooler** URL (DDL-safe; the workflows only run `import_seed`, which is plain DML, but the session pooler works for both and avoids a second URL to manage) |
| `KASHROOT_GOOGLE_SERVICE_ACCOUNT_JSON` | the whole JSON key file, as one line |
| `KASHROOT_SHEET_ID` | the spreadsheet id |
| `KASHROOT_SHEET_TAB` | the tab name |
| `KASHROOT_PUBLIC_API_ORIGIN` | your Render service URL, e.g. `https://kashroot-api.onrender.com` |
| `KASHROOT_TWILIO_ACCOUNT_SID` | from Twilio console |
| `KASHROOT_TWILIO_AUTH_TOKEN` | from Twilio console |
| `KASHROOT_TWILIO_WHATSAPP_FROM` | `whatsapp:+1...` (sandbox or your production sender) |
| `KASHROOT_TWILIO_CONTENT_SID` | `HX...`, only once you have an approved template |
| `KASHROOT_WHATSAPP_TO` | `whatsapp:+972...`, your own number |

**Render environment variables** (dashboard -> your service -> Environment) — read by
the confirm page (`GET`/`POST /sync/proposals/{id}`), which is the only sheet-sync
code that runs on Render itself:

| Variable | Value |
|---|---|
| `KASHROOT_GITHUB_DISPATCH_TOKEN` | the fine-grained PAT from step 3 |
| `KASHROOT_GITHUB_REPO` | `deltaforce26/kashroot` (or your fork) |
| `KASHROOT_PUBLIC_API_ORIGIN` | same value as above |

Render does not need the Google/Twilio secrets — it never fetches the sheet or sends
WhatsApp messages itself; the GitHub Actions workflows do that.

## 5. How approve/deny works

* The `sheet-sync` workflow runs at ~08:50 and ~19:50 Israel time (see the cron
  comment in `.github/workflows/sheet-sync.yml` for the DST caveat). It fetches the
  sheet, and if it changed since the last check, dry-runs the import.
* If the dry run shows real changes, you get one WhatsApp message: counts of
  additions/updates/deletions, any restaurants the prune logic *kept* despite being
  missing from the sheet (because a moderator has touched them — see
  `app/ingestion/seed_prune.py`), and a link.
* Tapping the link opens a page with **Approve**/**Deny** buttons (this is a real
  page load, not a WhatsApp preview — link previews can't accidentally approve
  anything). The link and its buttons are single-use and expire after 24 hours.
* **Approve** triggers `sheet-sync-apply.yml`, which writes the *exact* snapshot you
  reviewed (not a fresh fetch — if the sheet changed again since you got the message,
  that's a separate future proposal) and imports it with `--prune`, so the database
  ends up matching the sheet exactly. You get a second WhatsApp message with the
  result.
* **Deny** discards that proposal. Nothing changes. The next scheduled fetch will
  propose again if the sheet is still different from what's in the database.

## 6. Troubleshooting

* **No WhatsApp message arrived.** Check the `sheet-sync` workflow run in GitHub
  Actions — if it failed before the notify step, no failure message goes out either
  (rare: usually a secret is missing or malformed). If it says "sheet unchanged since
  the last proposal", that's expected — nothing to review.
* **The Approve link says "already decided" or "expired".** Only the newest proposal
  is ever live — a later fetch supersedes an older undecided one automatically. Wait
  for the next scheduled run, or trigger `sheet-sync` manually from the Actions tab
  (**workflow_dispatch**).
* **Approve says the workflow trigger failed.** Usually `KASHROOT_GITHUB_DISPATCH_TOKEN`
  on Render is missing, expired, or scoped to the wrong repo. The link stays valid —
  fix the token and tap Approve again.
* **Twilio messages stopped arriving after 24h of no reply.** You're outside the
  sandbox's or a plain sender's customer-service window — see step 2's Content
  Template setup, which is required for the workflow's own scheduled (business-
  initiated) messages.
* **Contract tests fail in `sheet-sync-apply`.** The sheet itself has a data problem
  (missing required column, unknown certifier id, etc. — see
  `tests/test_seed_corpus_contract.py` and `data/README.md`). Fix the sheet and wait
  for the next `sheet-sync` cycle; the bad proposal is simply denied/expired.
