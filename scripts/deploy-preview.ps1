# Deploy the CURRENT HEAD as the production deployment of the SEPARATE
# preview Pages project (maister-tracker-preview). Windows-safe: git
# archive -> zip -> Expand-Archive (no tar pipes). Self-verifying: refuses
# to print the URL unless every smoke check returns HTTP 200.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-preview.ps1
# Requires: Cloudflare login (wrangler) on this machine.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
$sha = (& git rev-parse --short HEAD).Trim()
$dirty = (& git status --porcelain)
Write-Host "Repo: $repoRoot"
Write-Host "Branch: $branch  HEAD: $sha"
if ($dirty) { Write-Host 'WARNING: working tree has uncommitted changes; deploying COMMITTED HEAD only.' }

# 1) Export exactly the committed tree as ZIP (Windows-safe, no tar pipe)
$d = Join-Path $env:TEMP 'mt-preview'
$z = Join-Path $env:TEMP 'mt-preview.zip'
if (Test-Path $d) { Remove-Item -Recurse -Force $d }
if (Test-Path $z) { Remove-Item -Force $z }
New-Item -ItemType Directory $d | Out-Null
& git archive --format=zip --output $z HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive -Path $z -DestinationPath $d -Force

# 2) Guard: index.html MUST be in the archive root (this is what the
#    "Nothing is here yet" symptom looks like when it is not)
if (-not (Test-Path (Join-Path $d 'index.html'))) { throw 'index.html is NOT in the export root - aborting' }
$fileCount = (Get-ChildItem $d -Recurse -File).Count
Write-Host "Export OK: $fileCount files, index.html in root"

# 3) Deploy as PRODUCTION deployment of the preview project (--branch main),
#    so https://maister-tracker-preview.pages.dev serves it. This is a
#    SEPARATE test project - the real production PWA is untouched.
npx.cmd -y wrangler pages deploy $d --project-name maister-tracker-preview --branch main --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw 'wrangler pages deploy failed' }

# 4) HTTP smoke: wrangler SUCCESS proves nothing - verify real responses
$base = 'https://maister-tracker-preview.pages.dev'
Write-Host "Waiting for the deployment to go live on $base ..."
$live = $false
foreach ($i in 1..30) {
  try {
    $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { $live = $true; break }
  } catch { Start-Sleep -Seconds 5 }
}
if (-not $live) { throw 'Preview did not return HTTP 200 within 150s - NOT verified' }

$okAll = $true
$paths = @('/', '/index.html', '/app.js', '/sw.js', '/js/ai/ai-ui.js', '/js/ai/ai-voice.js')
foreach ($p in $paths) {
  try {
    $resp = Invoke-WebRequest -Uri ($base + $p) -UseBasicParsing -TimeoutSec 15
    Write-Host ("{0,-22} -> HTTP {1}" -f $p, $resp.StatusCode)
    if ($resp.StatusCode -ne 200) { $okAll = $false }
  } catch {
    Write-Host ("{0,-22} -> FAILED" -f $p)
    $okAll = $false
  }
}

# 5) Freshness: deployed sw.js must byte-match the HEAD export (proves the
#    phone will receive THIS SHA's bundle, not a stale one)
$remoteSw = (Invoke-WebRequest -Uri "$base/sw.js" -UseBasicParsing -TimeoutSec 15).Content
$localSw = Get-Content (Join-Path $d 'sw.js') -Raw
if ($remoteSw -eq $localSw) {
  Write-Host ("FRESHNESS OK: deployed sw.js matches HEAD {0}" -f $sha)
} else {
  Write-Host 'FRESHNESS FAIL: deployed sw.js differs from HEAD export'
  $okAll = $false
}

if ($okAll) {
  Write-Host ''
  Write-Host 'ALL CHECKS PASSED'
  Write-Host ("OPEN ON PHONE: {0}  (SHA {1}, branch {2})" -f $base, $sha, $branch)
} else {
  throw 'SMOKE FAILED - do not open on phone'
}
