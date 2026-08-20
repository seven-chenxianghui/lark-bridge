[CmdletBinding()]
param(
	[ValidateSet('Ask', 'Manual', 'Startup', 'Skip')]
	[string]$RunMode = 'Ask',
	[switch]$SkipDependencies
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigPath = Join-Path $Root 'config\bridge.env'
$ExamplePath = Join-Path $Root 'config\bridge.env.windows.example'

function Read-EnvFile([string]$Path) {
	$values = @{}
	if (-not (Test-Path -LiteralPath $Path)) { return $values }
	foreach ($raw in Get-Content -LiteralPath $Path -Encoding UTF8) {
		if ($raw -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
			$values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
		}
	}
	return $values
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
	$lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
	$found = $false
	for ($index = 0; $index -lt $lines.Count; $index++) {
		if ($lines[$index] -match "^\s*$([regex]::Escape($Key))\s*=") {
			$lines[$index] = "$Key=$Value"
			$found = $true
		}
	}
	if (-not $found) { $lines += "$Key=$Value" }
	Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Read-Secret([string]$Prompt) {
	$secure = Read-Host $Prompt -AsSecureString
	$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
	try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
	finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Read-RunMode {
	Write-Host ''
	Write-Host '选择运行方式：'
	Write-Host '  1. 手动运行（本次启动，重启电脑后需手动启动）'
	Write-Host '  2. 开机后台运行（需要 UAC 和 Windows 账户密码）'
	Write-Host '  3. 暂不启动'
	switch (Read-Host '请输入 1、2 或 3') {
		'1' { return 'Manual' }
		'2' { return 'Startup' }
		default { return 'Skip' }
	}
}

Write-Host '=== Seven Lark Bridge 一键部署（Windows） ==='
if (-not (Test-Path -LiteralPath $ConfigPath)) {
	Copy-Item -LiteralPath $ExamplePath -Destination $ConfigPath
}

$config = Read-EnvFile $ConfigPath
if ([string]::IsNullOrWhiteSpace($config['FEISHU_APP_ID']) -or $config['FEISHU_APP_ID'] -match 'x{8,}') {
	Set-EnvValue $ConfigPath 'FEISHU_APP_ID' (Read-Host '请输入飞书 FEISHU_APP_ID（cli_ 开头）')
}
if ([string]::IsNullOrWhiteSpace($config['FEISHU_APP_SECRET'])) {
	Set-EnvValue $ConfigPath 'FEISHU_APP_SECRET' (Read-Secret '请输入飞书 FEISHU_APP_SECRET')
}
$config = Read-EnvFile $ConfigPath
if ([string]::IsNullOrWhiteSpace($config['FEISHU_OWNER_OPEN_ID'])) {
	Write-Host '新飞书应用需要管理员 OPEN_ID，可从 im.message.receive_v1 事件的 sender.sender_id.open_id 获取。'
	$owner = Read-Host '请输入 FEISHU_OWNER_OPEN_ID；已有迁移数据时可直接回车'
	if ($owner) { Set-EnvValue $ConfigPath 'FEISHU_OWNER_OPEN_ID' $owner }
}

$installArgs = @{ InstallBun = $true; SkipDependencies = $SkipDependencies }
& (Join-Path $PSScriptRoot 'install-windows.ps1') @installArgs

$bun = Get-Command bun.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $bun) { $bun = Get-Command bun.cmd -CommandType Application -ErrorAction SilentlyContinue }
if (-not $bun) { throw 'Bun 安装完成后仍无法找到，请重新打开 PowerShell 再运行本脚本。' }

Write-Host ''
Write-Host '=== 当前就绪状态 ==='
& $bun.Source run (Join-Path $PSScriptRoot 'check-readiness.ts')
if ($LASTEXITCODE -ne 0) {
	Write-Host ''
	Write-Host '当前尚不满足启动条件。处理上面的 MISSING 项后重新运行本脚本。' -ForegroundColor Yellow
	exit 1
}

if ($RunMode -eq 'Ask') { $RunMode = Read-RunMode }
$serviceScript = Join-Path $PSScriptRoot 'claw-service-windows.ps1'
switch ($RunMode) {
	'Manual' { & $serviceScript start }
	'Startup' { & $serviceScript install }
	'Skip' { Write-Host '已完成部署，未启动服务。手动运行：bun run src/server.ts' }
}

Write-Host ''
Write-Host '飞书后台仍需确认：机器人能力已开启、长连接已启用、已订阅 im.message.receive_v1 和 card.action.trigger、应用版本已发布。'
Write-Host '部署完成。请在群聊话题中 @机器人进行测试。'
