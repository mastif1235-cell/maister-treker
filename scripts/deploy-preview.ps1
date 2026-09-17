#Requires -Version 5.1
<#
  Deploy the CURRENT git HEAD to the SEPARATE preview Pages project
  (maister-tracker-preview). Production Master-Tracker is never touched.

  TRUTH MODEL (this is the whole point of this script):
    * the EXACT deployment URL printed by wrangler is the single source of
      truth: https://<hash>.maister-tracker-preview.pages.dev
    * the bare alias https://maister-tracker-preview.pages.dev is a CDN
      convenience that may propagate minutes later - it NEVER decides whether
      the deploy succeeded, and it is never waited on for 150 seconds.

  Windows-safe by design:
    * git archive --format=zip + Expand-Archive (no tar pipes);
    * npx.cmd (immune to the npx.ps1 / ExecutionPolicy breakage);
    * unique TEMP workdir mt-preview-<guid> - nothing shared, nothing
      pre-deleted, so no Test-Path/Remove-Item race in TEMP;
    * cleanup ONLY in finally, best-effort, SilentlyContinue, never fatal;
    * pure ASCII source (no BOM/codepage surprises in Windows PowerShell 5.1).

  Publishes exactly the COMMITTED HEAD - uncommitted local files can never
  land in the preview.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-preview.ps1

  Exit codes: 0 = deployment verified (alias state is informational only)
              1 = real failure (export, wrangler, HTTP smoke or freshness)
#>
[CmdletBinding()]
param(
  [string]$ProjectName = 'maister-tracker-preview',
  [string]$Branch = 'main',
  [int]$ExactReadyTimeoutSec = 60,
  [int]$AliasCheckTimeoutSec = 15,
  [switch]$SkipAliasCheck
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$RequiredPaths = @('/', '/app.js', '/sw.js', '/js/ai/ai-ui.js', '/js/ai/ai-voice.js')

function Write-Step([string]$message) { Write-Host ("==> " + $message) }
function Fail([string]$message) { throw $message }

# Pull the exact deployment URL out of the wrangler log.
# Bare alias (https://<project>.pages.dev) can NOT match: a sub-domain label
# before the project name is mandatory. Hash-looking sub-domains win over
# branch aliases; the LAST best match wins (wrangler prints it last).
function Get-ExactDeploymentUrl {
  param([string[]]$Lines, [string]$ProjectName)
  if (-not $Lines) { return '' }
  $pattern = 'https://([0-9a-z][0-9a-z-]*)\.' + [regex]::Escape($ProjectName) + '\.pages\.dev'
  $best = ''
  $bestRank = -1
  foreach ($line in $Lines) {
    if ($null -eq $line) { continue }
    # strip ANSI colour codes before matching
    $clean = [regex]::Replace([string]$line, "\x1B\[[0-9;]*[A-Za-z]", '')
    foreach ($m in [regex]::Matches($clean, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
      $sub = $m.Groups[1].Value.ToLowerInvariant()
      $rank = 1
      if ($sub -match '^[0-9a-f]{8}$') { $rank = 3 }
      elseif ($sub -match '^[0-9a-f]{6,40}$') { $rank = 2 }
      if ($sub -eq 'www' -or $sub -eq $ProjectName.ToLowerInvariant()) { $rank = 0 }
      if ($rank -ge $bestRank) {
        $bestRank = $rank
        $best = 'https://' + $sub + '.' + $ProjectName + '.pages.dev'
      }
    }
  }
  return $best
}

# CACHE_NAME marker of a service worker (works for any future v-number).
function Get-CacheMarker {
  param([string]$Content)
  if ([string]::IsNullOrWhiteSpace($Content)) { return '' }
  $m = [regex]::Match($Content, "CACHE_NAME\s*=\s*['""]([^'""]+)['""]")
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

function Invoke-UrlProbe {
  param([string]$Url, [int]$TimeoutSec = 15)
  $sep = '?'
  if ($Url.Contains('?')) { $sep = '&' }
  $target = $Url + $sep + 'mtcb=' + [DateTime]::UtcNow.Ticks   # defeat CDN cache
  $result = [pscustomobject]@{ Ok = $false; Status = 0; Content = ''; Error = '' }
  try {
    $resp = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec $TimeoutSec `
      -Headers @{ 'Cache-Control' = 'no-cache'; 'Pragma' = 'no-cache' }
    $result.Status = [int]$resp.StatusCode
    $result.Content = [string]$resp.Content
    $result.Ok = ($result.Status -eq 200)
  } catch {
    $ex = $_.Exception
    try { if ($ex.Response) { $result.Status = [int]$ex.Response.StatusCode } } catch {}
    $result.Error = [string]$ex.Message
  }
  return $result
}

# ---------------------------------------------------------------- repo / HEAD
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($repoRoot) -or -not (Test-Path -LiteralPath (Join-Path $repoRoot 'index.html'))) {
  Fail 'Cannot locate the repository root (scripts\deploy-preview.ps1 must stay inside the repo).'
}
Set-Location -LiteralPath $repoRoot

$branchName = (& git rev-parse --abbrev-ref HEAD)
if ($LASTEXITCODE -ne 0) { Fail 'git rev-parse failed - is this a git repository?' }
$branchName = ([string]$branchName).Trim()
$sha = ([string](& git rev-parse --short HEAD)).Trim()
$dirty = (& git status --porcelain)

Write-Step ("Repo: " + $repoRoot)
Write-Step ("Branch: " + $branchName + "   Publishing exactly SHA: " + $sha + " (git HEAD)")
if ($dirty) {
  Write-Host 'NOTE: working tree has uncommitted changes - they will NOT be published (HEAD only).'
}

# ------------------------------------------------- unique TEMP workdir (GUID)
$tempRoot = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tempRoot) -or -not (Test-Path -LiteralPath $tempRoot)) {
  Fail 'TEMP environment variable is not set or points to a missing folder.'
}
$tempRoot = [System.IO.Path]::GetFullPath($tempRoot.Trim())
$workName = 'mt-preview-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$workDir = Join-Path $tempRoot $workName
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $workDir)) { Fail ("Failed to create work directory: " + $workDir) }
$workDir = [System.IO.Path]::GetFullPath($workDir)
if (-not $workDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { Fail 'Work directory escaped TEMP - aborting.' }
$zipPath = Join-Path $tempRoot ($workName + '.zip')

$exitCode = 1
try {
  # ----------------------------------------------------- export committed HEAD
  Write-Step 'Exporting git HEAD (zip)...'
  & git archive --format=zip --output $zipPath HEAD
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $zipPath)) { Fail 'git archive failed.' }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $workDir -Force

  if (-not (Test-Path -LiteralPath (Join-Path $workDir 'index.html'))) {
    Fail 'index.html is NOT in the export root - aborting (would publish an empty site).'
  }
  $deployDir = (Resolve-Path -LiteralPath $workDir).Path
  $fileCount = (Get-ChildItem -LiteralPath $deployDir -Recurse -File).Count
  Write-Host ("Export OK: " + $fileCount + " files, index.html in root -> " + $deployDir)

  $localSwPath = Join-Path $deployDir 'sw.js'
  if (-not (Test-Path -LiteralPath $localSwPath)) { Fail 'sw.js missing from the export - aborting.' }
  $expectedMarker = Get-CacheMarker (Get-Content -LiteralPath $localSwPath -Raw)
  if ([string]::IsNullOrWhiteSpace($expectedMarker)) { Fail 'Could not read CACHE_NAME from the exported sw.js.' }
  Write-Host ("HEAD sw.js CACHE_NAME: " + $expectedMarker)

  # ------------------------------------------------------------------- deploy
  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if (-not $npx) { Fail 'npx.cmd not found - install Node.js or run from a shell where npm is on PATH.' }

  Write-Step ("Deploying to Pages project '" + $ProjectName + "' (branch binding: " + $Branch + ")...")
  $deployLines = New-Object System.Collections.Generic.List[string]
  $deployExit = 0
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # native stderr must not throw
  try {
    & $npx.Source -y wrangler pages deploy $deployDir --project-name $ProjectName --branch $Branch --commit-dirty=true 2>&1 |
      ForEach-Object {
        $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string]$_ }
        Write-Host $line
        [void]$deployLines.Add($line)
      }
    $deployExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($deployExit -ne 0) { Fail ("wrangler pages deploy failed (exit " + $deployExit + ").") }

  # ------------------------------------------- exact URL = source of truth
  $exactUrl = Get-ExactDeploymentUrl -Lines $deployLines.ToArray() -ProjectName $ProjectName
  if ([string]::IsNullOrWhiteSpace($exactUrl)) {
    Fail 'Could not parse the exact deployment URL from the wrangler output - cannot verify this deploy.'
  }
  Write-Host ''
  Write-Step ("Exact deployment URL: " + $exactUrl)

  Write-Step ("Waiting for the exact deployment to answer (max " + $ExactReadyTimeoutSec + "s)...")
  $deadline = (Get-Date).AddSeconds($ExactReadyTimeoutSec)
  $rootProbe = Invoke-UrlProbe -Url ($exactUrl + '/')
  while (-not $rootProbe.Ok -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $rootProbe = Invoke-UrlProbe -Url ($exactUrl + '/')
  }
  if (-not $rootProbe.Ok) {
    Fail ("Exact deployment URL did not return HTTP 200 (last status " + $rootProbe.Status + ") - NOT verified.")
  }

  # ----------------------------------------------------- required files smoke
  Write-Step 'Verifying required files on the exact deployment URL...'
  $okAll = $true
  foreach ($p in $RequiredPaths) {
    $probe = Invoke-UrlProbe -Url ($exactUrl + $p)
    if (-not $probe.Ok) {
      Start-Sleep -Seconds 2
      $probe = Invoke-UrlProbe -Url ($exactUrl + $p)   # one retry, cold edge
    }
    if ($probe.Ok) {
      Write-Host ("  {0,-22} -> HTTP 200" -f $p)
    } else {
      $detail = if ($probe.Status -gt 0) { "HTTP " + $probe.Status } else { "no response" }
      Write-Host ("  {0,-22} -> FAILED ({1})" -f $p, $detail)
      $okAll = $false
    }
  }

  # ------------------------------------------------------------- freshness
  Write-Step 'Verifying freshness (remote sw.js CACHE_NAME vs HEAD)...'
  $swProbe = Invoke-UrlProbe -Url ($exactUrl + '/sw.js')
  $remoteMarker = Get-CacheMarker $swProbe.Content
  if ($remoteMarker -and $remoteMarker -eq $expectedMarker) {
    Write-Host ("  FRESHNESS OK: " + $remoteMarker + " == HEAD " + $sha)
  } else {
    $shown = if ($remoteMarker) { $remoteMarker } else { '<none>' }
    Write-Host ("  FRESHNESS FAIL: remote '" + $shown + "' vs HEAD '" + $expectedMarker + "'")
    $okAll = $false
  }

  if (-not $okAll) { Fail 'SMOKE FAILED on the exact deployment URL - do not open on phone.' }

  # ----------------------------------- bare alias: separate, optional, short
  $aliasUrl = 'https://' + $ProjectName + '.pages.dev'
  $aliasLive = $false
  if ($SkipAliasCheck) {
    Write-Step 'Alias check skipped (-SkipAliasCheck).'
  } else {
    Write-Step ("Optional alias check (max " + $AliasCheckTimeoutSec + "s, cannot affect the result)...")
    $aliasDeadline = (Get-Date).AddSeconds($AliasCheckTimeoutSec)
    while ($true) {
      $aliasRoot = Invoke-UrlProbe -Url ($aliasUrl + '/') -TimeoutSec 8
      if ($aliasRoot.Ok) {
        $aliasSw = Invoke-UrlProbe -Url ($aliasUrl + '/sw.js') -TimeoutSec 8
        if ((Get-CacheMarker $aliasSw.Content) -eq $expectedMarker) { $aliasLive = $true; break }
        Write-Host '  alias answers but still serves an older build'
      } else {
        Write-Host ("  alias not ready (status " + $aliasRoot.Status + ")")
      }
      if ((Get-Date) -ge $aliasDeadline) { break }
      Start-Sleep -Seconds 4
    }
  }

  # ------------------------------------------------------------------ report
  Write-Host ''
  Write-Host 'DEPLOYMENT VERIFIED'
  Write-Host ("EXACT DEPLOYMENT URL: " + $exactUrl)
  Write-Host ("SHA: " + $sha + "   BRANCH: " + $branchName + "   CACHE: " + $expectedMarker)
  if ($aliasLive) {
    Write-Host 'ALIAS LIVE'
    Write-Host ("OPEN ON PHONE: " + $aliasUrl)
  } else {
    Write-Host 'WARNING: alias not propagated yet'
    Write-Host ("OPEN ON PHONE: " + $exactUrl)
  }
  $exitCode = 0
} catch {
  Write-Host ''
  Write-Host ("DEPLOY FAILED: " + $_.Exception.Message)
  $exitCode = 1
} finally {
  # best-effort cleanup - can NEVER break the deploy result
  try {
    if ($workDir -and (Test-Path -LiteralPath $workDir)) {
      Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  try {
    if ($zipPath -and (Test-Path -LiteralPath $zipPath)) {
      Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

exit $exitCode
