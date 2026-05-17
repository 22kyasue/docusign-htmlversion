#!/usr/bin/env pwsh
# Sovereign Sign installer (Windows / PowerShell).
# Copies the skill into ~/.claude/skills/ and writes a config.json
# pointing at this clone so the skill can find it later.

[CmdletBinding()]
param(
    [int]$Port = 3789,
    [switch]$Force,
    [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'

$repoRoot   = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$skillSrc   = Join-Path $repoRoot '.claude\skills\sovereign-sign'
$claudeRoot = Join-Path $env:USERPROFILE '.claude'
$skillDest  = Join-Path $claudeRoot 'skills\sovereign-sign'

Write-Host "Sovereign Sign installer" -ForegroundColor Cyan
Write-Host "  repo:  $repoRoot"
Write-Host "  skill: $skillDest"
Write-Host "  port:  $Port"

if (-not (Test-Path -LiteralPath $skillSrc)) {
    throw "Skill source not found at $skillSrc"
}

if (Test-Path -LiteralPath $skillDest) {
    if (-not $Force) {
        Write-Host "Skill already installed. Re-run with -Force to overwrite." -ForegroundColor Yellow
    } else {
        Remove-Item -LiteralPath $skillDest -Recurse -Force
    }
}

if (-not (Test-Path -LiteralPath $skillDest)) {
    New-Item -ItemType Directory -Path $skillDest -Force | Out-Null
}

Copy-Item -LiteralPath (Join-Path $skillSrc 'SKILL.md') -Destination $skillDest -Force

$config = [ordered]@{
    repoPath    = $repoRoot
    port        = $Port
    installedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5

$configPath = Join-Path $skillDest 'config.json'
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $configPath" -ForegroundColor Green

if (-not $SkipDeps) {
    Write-Host "Installing npm dependencies (this also copies the pdfjs worker)..." -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  - Start the server manually:  npm run dev -- --port $Port"
Write-Host "  - Then in Claude Code:         /sovereign-sign"
