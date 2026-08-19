<#
.SYNOPSIS
    Brings the whole Kashroot POC up in one command, for the demo.

.DESCRIPTION
    Starts the containers, applies migrations, then launches the API and the web app
    in their own windows. Written so the demo can be restarted cold in under a minute
    if something wedges mid-presentation.

    Two environment quirks on this box are handled here rather than left as folklore:
      * docker is NOT on PATH   - resolved by absolute path below.
      * Postgres is on 5433     - a native Windows PostgreSQL 16 service owns 5432,
                                  and it fails as an auth error rather than a port
                                  conflict, which is a genuinely confusing way to lose
                                  twenty minutes.

.EXAMPLE
    .\run-demo.ps1
    .\run-demo.ps1 -SkipMigrations
#>
[CmdletBinding()]
param(
    [switch]$SkipMigrations,
    [int]$ApiPort = 8000,
    [int]$WebPort = 5199
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }

# ── Docker ────────────────────────────────────────────────────────────────────
$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if (-not (Test-Path $docker)) {
    $cmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        throw "docker.exe not found. Start Docker Desktop and wait for 'Engine running', then re-run."
    }
    $docker = $cmd.Source
}

Write-Step "Starting containers (Postgres+PostGIS, Redis, MinIO)"
& $docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed. Is Docker Desktop running?" }

Write-Step "Waiting for Postgres to report healthy"
$healthy = $false
foreach ($i in 1..30) {
    $status = (& $docker compose ps --format "{{.Service}} {{.Status}}" | Select-String -Pattern '^db ')
    if ($status -match 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw "Postgres did not become healthy in 60s. Check: $docker compose logs db" }
Write-Ok "database is healthy on port 5433"

# ── Migrations ────────────────────────────────────────────────────────────────
if (-not $SkipMigrations) {
    Write-Step "Applying migrations"
    Push-Location $root
    try {
        python -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed." }
        Write-Ok "schema at head"
    }
    finally { Pop-Location }
}

# ── Sanity: is there actually data? ───────────────────────────────────────────
# A demo against an empty database looks like a broken app rather than an empty one,
# so fail loudly here instead of on stage.
Write-Step "Checking the corpus is loaded"
$counts = & $docker compose exec -T db psql -U kashroot -d kashroot -tAc `
    "select (select count(*) from restaurant), (select count(*) from certificate), (select count(*) from restaurant where geo is not null);"
if ([string]::IsNullOrWhiteSpace($counts)) {
    Write-Warn "could not read row counts - continuing, but check the database"
}
else {
    $parts = $counts.Trim() -split '\|'
    Write-Ok "$($parts[0]) restaurants, $($parts[1]) certificates, $($parts[2]) geocoded"
    if ([int]$parts[0] -eq 0) {
        Write-Warn "NO RESTAURANTS. Run: python -m app.cli seed-import --apply"
    }
}

# ── API ───────────────────────────────────────────────────────────────────────
Write-Step "Starting the API on :$ApiPort"
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$root'; python -m uvicorn app.main:app --port $ApiPort --host 127.0.0.1"
)

# ── Web ───────────────────────────────────────────────────────────────────────
# Dev server, not `vite preview`: preview has no proxy, so a preview build cannot
# reach the API and every screen falls back to its error state.
Write-Step "Starting the web app on :$WebPort (dev server - proxied to the API)"
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$root\web'; npx vite --port $WebPort --host 127.0.0.1"
)

Write-Step "Waiting for both to answer"
$apiUp = $false
$webUp = $false
foreach ($i in 1..30) {
    if (-not $apiUp) {
        try { Invoke-WebRequest "http://127.0.0.1:$ApiPort/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $apiUp = $true } catch {}
    }
    if (-not $webUp) {
        try { Invoke-WebRequest "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $webUp = $true } catch {}
    }
    if ($apiUp -and $webUp) { break }
    Start-Sleep -Seconds 2
}

Write-Host ""
if ($apiUp) { Write-Ok "API  http://127.0.0.1:$ApiPort/health" } else { Write-Warn "API did not answer - check its window" }
if ($webUp) { Write-Ok "APP  http://127.0.0.1:$WebPort/" }      else { Write-Warn "web did not answer - check its window" }

Write-Host ""
Write-Host "  Demo app:  http://127.0.0.1:$WebPort/" -ForegroundColor White
Write-Host "  API docs:  http://127.0.0.1:$ApiPort/docs" -ForegroundColor White
Write-Host "  Moderation console lives in admin/ (separate: cd admin; npm run dev)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  If the app looks wrong on first load, clear site data - a profile saved" -ForegroundColor DarkGray
Write-Host "  before the schema version existed can still be cached in the browser." -ForegroundColor DarkGray
Write-Host ""
