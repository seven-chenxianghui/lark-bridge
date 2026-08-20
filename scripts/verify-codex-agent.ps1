[CmdletBinding()]
param([string]$Workspace)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PackRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Workspace) { $Workspace = $PackRoot }
$npmModules = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules'
$codex = Get-ChildItem -LiteralPath $npmModules -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $codex) { throw 'Spawnable Codex CLI not found. Install it with: npm install -g @openai/codex' }
$bun = (Get-Command bun -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1).Source
$env:CODEX_BIN = $codex
& $bun run (Join-Path $PackRoot 'scripts\verify-codex-app-server.ts') $Workspace
if ($LASTEXITCODE) { throw "Codex App Server verification failed with exit code $LASTEXITCODE" }
