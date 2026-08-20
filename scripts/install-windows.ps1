[CmdletBinding()]
param([switch]$InstallBun, [switch]$SkipDependencies)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Config = Join-Path $Root 'config\bridge.env'
$Example = Join-Path $Root 'config\bridge.env.windows.example'
$Runtime = Join-Path (Split-Path $Root -Parent) '.seven-lark-runtime'

function Read-Config([string]$Path) {
	$values = @{}
	foreach ($raw in Get-Content -LiteralPath $Path -Encoding UTF8) {
		if ($raw -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
			$values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
		}
	}
	return $values
}

function Find-Application([string[]]$Names) {
	foreach ($name in $Names) {
		$command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue |
			Select-Object -First 1
		if ($command) { return $command.Source }
	}
	return $null
}

function Find-Codex {
	$direct = Find-Application @('codex.exe', 'codex')
	if ($direct) { return $direct }
	$modules = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules'
	if (Test-Path -LiteralPath $modules) {
		$binary = Get-ChildItem -LiteralPath $modules -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
			Select-Object -First 1
		if ($binary) { return $binary.FullName }
	}
	return $null
}

if (-not (Test-Path -LiteralPath $Config)) {
	Copy-Item -LiteralPath $Example -Destination $Config
	Write-Host "Created $Config"
	Write-Host 'Fill FEISHU_APP_ID and FEISHU_APP_SECRET, then run again.'
	exit 0
}

$values = Read-Config $Config
foreach ($key in @('FEISHU_APP_ID', 'FEISHU_APP_SECRET')) {
	if ([string]::IsNullOrWhiteSpace($values[$key]) -or $values[$key] -match 'x{8,}') {
		throw "Set $key in config/bridge.env"
	}
}

$codex = Find-Codex
if (-not $codex) { throw 'Codex CLI was not found. Install: npm install -g @openai/codex' }
$bun = Find-Application @('bun.exe', 'bun')
if (-not $bun -and $InstallBun) {
	Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
	$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
	$bun = Find-Application @('bun.exe', 'bun')
}
if (-not $bun) { throw 'Bun was not found. Run this installer with -InstallBun.' }

if (-not $SkipDependencies) {
	Push-Location $Root
	try {
		& $bun install --frozen-lockfile
		if ($LASTEXITCODE) { throw 'bun install failed' }
	} finally { Pop-Location }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Runtime 'logs'), (Join-Path $Runtime 'state') |
	Out-Null
Write-Host 'Windows installation complete.'
Write-Host "Codex: $codex"
Write-Host "Start: powershell -ExecutionPolicy Bypass -File $PSScriptRoot\claw-service-windows.ps1 start"
