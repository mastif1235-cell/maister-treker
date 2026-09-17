# Deploy the CURRENT HEAD as the production deployment of the SEPARATE
# preview Pages project (maister-tracker-preview).
#
# Windows-safe by design:
#   - unique temp workdir (GUID) => NO pre-deletion, nothing to collide with;
#   - ZIP + Expand-Archive (no tar pipes);
#   - all cleanup happens in try/finally, best-effort, NEVER fatal;
#   - deploy via npx.cmd; URL printed ONLY after HTTP smoke passes.
# Non-zero exit code ONLY on real deploy/smoke failures.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-preview.ps1
# Note:   publishes exactly the COMMITTED HEAD (git archive) - uncommitted
#         local files never land in the preview.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Fail([string]$message) { throw $message }

# ── repo / identity ────────────────────────────────────────────────────────
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($repoRoot) -or -not (Test-Path -LiteralPath (Join-Path $repoRoot 'index.html'))) {
  Fail 'Cannot locate the repository root (scripts\deploy-preview.ps1 must stay inside the repo).'
}
Set-Location -LiteralPath $repoRoot

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'git rev-parse failed - is this a git repository?' }
$sha = (& git rev-parse --short HEAD).Trim()
$dirty = (& git status --porcelain)

Write-Host "Repo: $repoRoot"
Write-Host "Branch: $branch   Publishing exactly SHA: $sha (git HEAD)"
if ($dirty) {
  Write-Host 'NOTE: working tree has uncommitted changes - they will NOT be published (HEAD only). This is expected and safe.'
}

# ── unique temp workdir: create fresh, never delete anything up-front ─────
$tempRoot = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tempRoot) -or -not (Test-Path -LiteralPath $tempRoot)) {
  Fail 'TEMP environment variable is not set or points to a missing folder.'
}
$tempRoot = [System.IO.Path]::GetFullPath($tempRoot.Trim())
$workName = 'mt-preview-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$workDir = Join-Path $tempRoot $workName
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
$workDir = [System.IO.Path]::GetFullPath($workDir)
if (-not (Test-Path -LiteralPath $workDir)) { Fail "Failed to create work directory: $workDir" }
if (-not $workDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Fail 'Work directory escaped TEMP - aborting.' }
$zipPath = Join-Path $tempRoot ($workName + '.zip')

try {
  # ── export exactly the committed tree as ZIP ─────────────────────────────
  & git archive --format=zip --output $zipPath HEAD
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $zipPath)) { Fail 'git archive failed.' }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $workDir -Force

  # ── guard: index.html MUST be in the export root ─────────────────────────
  if (-not (Test-Path -LiteralPath (Join-Path $workDir 'index.html'))) {
    Fail 'index.html is NOT in the export root - aborting (would publish an empty site).'
  }
  $fileCount = (Get-ChildItem -LiteralPath $workDir -Recurse -File).Count
  $deployDir = (Resolve-Path -LiteralPath $workDir).Path
  Write-Host "Export OK: $fileCount files, index.html in root -> $deployDir"

  # ── deploy: production binding of the SEPARATE preview project ───────────
  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if (-not $npx) { Fail 'npx.cmd not found - install Node.js or run from a shell where npm is on PATH.' }
  & $npx.Source -y wrangler pages deploy $deployDir --project-name maister-tracker-preview --branch main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { Fail 'wrangler pages deploy failed.' }

  # ── HTTP smoke: wrangler SUCCESS proves nothing - verify real responses ──
  $base = 'https://maister-tracker-preview.pages.dev'
  Write-Host "Waiting for the deployment to go live on $base ..."
  $live = $false
  foreach ($i in 1..30) {
    try {
      $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200) { $live = $true; break }
    } catch { Start-Sleep -Seconds 5 }
  }
  if (-not $live) { Fail 'Preview did not return HTTP 200 within 150s - NOT verified.' }

  $okAll = $true
  foreach ($p in @('/', '/index.html', '/app.js', '/sw.js', '/js/ai/ai-ui.js', '/js/ai/ai-voice.js')) {
    try {
      $resp = Invoke-WebRequest -Uri ($base + $p) -UseBasicParsing -TimeoutSec 15
      Write-Host ("{0,-22} -> HTTP {1}" -f $p, $resp.StatusCode)
      if ($resp.StatusCode -ne 200) { $okAll = $false }
    } catch {
      Write-Host ("{0,-22} -> FAILED" -f $p)
      $okAll = $false
    }
  }

  # ── freshness: deployed sw.js must carry HEAD's cache revision ───────────
  # (regex on the CACHE_NAME marker: encoding-proof, proves the phone gets
  #  THIS release's bundle, not a stale one)
  $remoteSw = (Invoke-WebRequest -Uri "$base/sw.js" -UseBasicParsing -TimeoutSec 15).Content
  $localSw = Get-Content -LiteralPath (Join-Path $workDir 'sw.js') -Raw
  $remoteMarker = [regex]::Match($remoteSw, 'maister-treker-v67-runtime-\d+').Value
  $localMarker = [regex]::Match($localSw, 'maister-treker-v67-runtime-\d+').Value
  if ($remoteMarker -and $remoteMarker -eq $localMarker) {
    Write-Host ("FRESHNESS OK: deployed sw.js cache marker {0} matches HEAD {1}" -f $remoteMarker, $sha)
  } else {
    Write-Host ("FRESHNESS FAIL: remote '{0}' vs local '{1}'" -f $remoteMarker, $localMarker)
    $okAll = $false
  }

  if (-not $okAll) { Fail 'SMOKE FAILED - do not open on phone.' }

  Write-Host ''
  Write-Host 'ALL CHECKS PASSED'
  Write-Host ("OPEN ON PHONE: {0}  (SHA {1}, branch {2})" -f $base, $sha, $branch)
  exit 0
} finally {
  # best-effort cleanup - can NEVER break the deploy result
  try {
    if ($workDir -and (Test-Path -LiteralPath $workDir)) { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
  } catch { Write-Host 'Cleanup warning (ignored).' }
  try {
    if ($zipPath -and (Test-Path -LiteralPath $zipPath)) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
  } catch { Write-Host 'Cleanup warning (ignored).' }
}
