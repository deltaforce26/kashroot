# Deploy runbook — hosted MVP

Getting Kashroot onto a public URL: the FastAPI service on **Render**, the consumer PWA
on **Vercel**, both pointed at the existing **Supabase** database.

The moderation console (`admin/`) is deliberately **not** deployed. Its auth is still
bearer tokens in `sessionStorage` (NOTES.md), which is not fit for a public origin.

> **Architecture constraint that drives all of this:** the API mounts **no CORS
> middleware**, on purpose (`app/main.py`). The browser therefore must never call the
> API cross-origin. Vercel reverse-proxies `/v1/*` and `/api/*` through to Render, so
> every request the browser makes is same-origin. Do not "fix" a failing request by
> adding CORS — fix the rewrite.

---

## Order matters

Migrations first, then the API, then the web app. Deploying code whose models are ahead
of the database is the failure this ordering avoids — and on the free tier nothing runs
migrations for you (see "Free tier" below).

---

## 1. Database — already done, verify only

The Supabase project is populated and current. Confirm before deploying:

```powershell
.venv\Scripts\python.exe -m app.cli db-check
```

Expect `alembic revision 0008_enable_row_level_security`, `postgis 3.3.7` and
`row-level security ... all protected`. An unprotected table fails the check: on
Supabase it is readable and writable by anyone with the project URL (see
`docs/supabase-runbook.md`).

If a future change adds a migration, run it **from your machine, before pushing**, with
the **session pooler** URL (port 5432):

```powershell
$env:KASHROOT_DATABASE_URL="postgresql+psycopg://postgres.<ref>:<pw>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
.venv\Scripts\python.exe -m alembic upgrade head
```

DDL needs one stable session, which the transaction pooler cannot give it.

---

## 2. API on Render

`render.yaml` at the repo root is a Blueprint. In the Render dashboard:
**New → Blueprint** → connect `deltaforce26/kashroot` → it reads `render.yaml`.

It deploys from **`main`**. Make sure the work you want live is on `main`, not `dev`.

### Environment variables to paste

Render prompts for every var marked `sync: false`. None of them are in git.

| Key | Value |
|---|---|
| `KASHROOT_DATABASE_URL` | Supabase **transaction** pooler, port **6543**, scheme `postgresql+psycopg://` |
| `KASHROOT_SUPABASE_URL` | Supabase Project URL |
| `KASHROOT_SUPABASE_SERVICE_KEY` | The **secret** key (`sb_secret_…`), never the publishable one |
| `KASHROOT_ADMIN_API_TOKENS` | `{}` — the admin console is not deployed, so nothing should authenticate |
| `KASHROOT_GOOGLE_MAPS_API_KEY` | Server-side Geocoding key. Not the browser key |

> **The database URL here differs from your local `.env`.** Local uses the *session*
> pooler (5432) because it also runs migrations. The deployed app should use the
> *transaction* pooler (**6543**) — same host and credentials, different port. Prepared
> statements auto-disable for it (`app/db/connection.py`).

> `KASHROOT_ADMIN_API_TOKENS` set to `{}` makes every admin endpoint 401. That is the
> correct posture for a public deployment with no real moderator accounts.

### Free tier

The service is on `plan: free`, which means two things:

1. **No `preDeployCommand`.** Migrations are the manual step in §1. It is commented out
   in `render.yaml` with the line to restore if you upgrade.
2. **It spins down after ~15 minutes idle**, and the next request pays a **~50 second**
   cold start. See §5.

### Verify

```powershell
curl https://<your-service>.onrender.com/health
curl https://<your-service>.onrender.com/health/db
```

Expect `{"status":"ok",...}` and a PostGIS version. **Write down the real hostname** —
Render only gives you `kashroot-api.onrender.com` if that name is globally free, and
§3 hardcodes it.

---

## 3. Web app on Vercel

**New Project** → same repo → **Root Directory: `web`**. `web/vercel.json` supplies the
build command, output directory and rewrites.

### Point the rewrites at the real API host

`web/vercel.json` currently names `https://kashroot-api.onrender.com`. If Render gave
you a different hostname, edit both rewrite destinations to match **before** deploying.
A wrong host here fails as a 404 on every API call, with no CORS error to hint at why.

### Environment variables

| Key | Value |
|---|---|
| `VITE_API_MODE` | `live` |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | The referrer-restricted **browser** key |

Both are baked in at build time, so changing either needs a redeploy, not a restart.

> Never put `KASHROOT_GOOGLE_MAPS_API_KEY` (the server geocoding key) here. Anything
> prefixed `VITE_` is compiled into the bundle and published to the world.

### Google Maps key — the step that is always forgotten

The browser key is restricted by HTTP referrer. Until the Vercel domain is on its
allowlist, the map screen fails **in production only** — it works locally, so it looks
fine right up until the demo.

In Google Cloud Console → Credentials → the browser key → Website restrictions, add:

```
https://<your-project>.vercel.app/*
```

The map degrading to its striped placeholder is the symptom. That fallback is designed
and honest, so it is survivable live — but it should be a choice, not a surprise.

---

## 4. End-to-end verification

Do this on a phone, not just a laptop — the audience will be on phones.

- [ ] `https://<vercel-domain>/` loads, onboarding appears
- [ ] Certifier picker lists **three** badatzim (`rabbanut_bnei_brak` was merged away)
- [ ] Pick "Selected Badatzim" + glatt + chalav yisrael → Jerusalem list renders
- [ ] אייס סטורי → **MATCH**, evidence panel names certifier, attributes, expiry
- [ ] חומוס אליהו → **NO_MATCH** on `attribute_false: glatt`
- [ ] דנבר סטייק האוס → **UNKNOWN**, expired
- [ ] Bnei Brak + glatt → several MATCHes under Badatz Rav Landa
- [ ] Hebrew RTL correct; language toggle works
- [ ] Map screen: either a real map, or the striped placeholder with its explanation
- [ ] Open in a private window — a first-time visitor with no cached profile

---

## 5. Cold start — the live-demo hazard

On the free tier the first request after idle takes ~50 seconds. If the audience opens
the link themselves, whoever taps first pays that, and a spinner with no explanation
reads as broken.

Two mitigations, both worth having:

**Keep it warm.** Point any free uptime pinger (cron-job.org, UptimeRobot) at
`https://<your-service>.onrender.com/health` every **10 minutes**. Under Render's
~15-minute idle window that keeps the instance up. Set it up the day before, not the
morning of.

**Warm it by hand before presenting.** Load `/health` in a browser tab ~2 minutes
before you start, and confirm it returns instantly rather than hanging.

If it does go cold mid-demo, the app now says it is waking up rather than showing a
bare spinner — but that is a consolation prize, not a plan.

---

## Rollback

- **Web:** Vercel keeps every deployment. Promote the previous one — instant.
- **API:** Render → Deploys → redeploy the previous commit.
- **Database:** there is no automatic rollback. Schema changes go through Alembic
  (`alembic downgrade -1`); data changes are audited in `audit_log` but not reversible
  by a single command. This is why the merge script had a dry run.
