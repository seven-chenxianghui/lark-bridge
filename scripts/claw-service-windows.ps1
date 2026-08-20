[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'restart-defer', 'status', 'logs', 'run')]
    [string]$Action = 'status',
    [int]$DelaySeconds = 20,
    [System.Management.Automation.PSCredential]$Credential
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PackRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigFile = Join-Path $PackRoot 'config\bridge.env'
$TaskName = 'SevenLarkBridge'

function Import-DotEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Config not found: $Path" }
    $values = @{}
    foreach ($raw in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
        $key, $value = $line.Split('=', 2)
        $value = $value.Trim().Trim('"').Trim("'")
        $values[$key.Trim()] = $value
        [Environment]::SetEnvironmentVariable($key.Trim(), $value, 'Process')
    }
    return $values
}

$config = Import-DotEnv $ConfigFile
if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }
$RuntimeDir = if ($config['RUNTIME_DIR']) { [IO.Path]::GetFullPath($config['RUNTIME_DIR']) } else {
    Join-Path (Split-Path $PackRoot -Parent) '.seven-lark-runtime'
}
$LogDir = Join-Path $RuntimeDir 'logs'
$LogFile = Join-Path $LogDir 'bridge.log'
$ErrorLog = Join-Path $LogDir 'bridge.error.log'
$PidFile = Join-Path $RuntimeDir 'state\bridge.pid'
New-Item -ItemType Directory -Force -Path $LogDir, (Split-Path $PidFile -Parent) | Out-Null

function Get-ClawProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    $id = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($id -notmatch '^\d+$') { return $null }
    return Get-Process -Id ([int]$id) -ErrorAction SilentlyContinue
}

function Resolve-BunExecutable {
    $native = Get-Command bun.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($native) { return $native.Source }

    $shim = Get-Command bun.cmd -CommandType Application -ErrorAction SilentlyContinue
    if ($shim) {
        $npmBinary = Join-Path (Split-Path $shim.Source -Parent) 'node_modules\bun\bin\bun.exe'
        if (Test-Path -LiteralPath $npmBinary) { return $npmBinary }
    }

	foreach ($candidate in @(
		(Join-Path $env:USERPROFILE '.bun\bin\bun.exe'),
		(Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe')
	)) {
		if (Test-Path -LiteralPath $candidate) { return $candidate }
	}
    throw 'Bun executable was not found; run install-windows.ps1 -InstallBun'
}

function Get-BridgeTask {
	return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Test-IsElevated {
	$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
	return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Rotate-Logs {
	foreach ($path in @($LogFile, $ErrorLog)) {
		if (-not (Test-Path -LiteralPath $path)) { continue }
		if ((Get-Item -LiteralPath $path).Length -lt 10MB) { continue }
		$archive = "$path.1"
		Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
		Move-Item -LiteralPath $path -Destination $archive
	}
}

function Start-Claw {
    if (Get-ClawProcess) { Write-Host 'Service is already running'; return }
	$task = Get-BridgeTask
	if ($task) {
		Start-ScheduledTask -TaskName $TaskName
		for ($attempt = 0; $attempt -lt 20 -and -not (Get-ClawProcess); $attempt++) { Start-Sleep -Milliseconds 500 }
		$process = Get-ClawProcess
		if (-not $process) { throw "Scheduled task did not start; see $ErrorLog" }
		Write-Host "Started scheduled task PID $($process.Id)"
		return
	}
    if (-not (Test-Path -LiteralPath (Join-Path $PackRoot 'src\server.ts'))) { throw 'src/server.ts was not found' }
	Rotate-Logs
    $bun = Resolve-BunExecutable
    $process = Start-Process -FilePath $bun -ArgumentList @('run', 'src/server.ts') -WorkingDirectory $PackRoot `
        -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLog -WindowStyle Hidden -PassThru
    $process.Id | Set-Content -LiteralPath $PidFile -Encoding ASCII
    Start-Sleep -Milliseconds 800
    if ($process.HasExited) { throw "Service failed to start; see $ErrorLog" }
    Write-Host "Started PID $($process.Id)"
}

function Stop-Claw {
	if (Get-BridgeTask) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    $process = Get-ClawProcess
    if (-not $process) { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue; Write-Host 'Service is not running'; return }
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Stopped'
}

switch ($Action) {
    'run' {
		Rotate-Logs
        $bun = Resolve-BunExecutable
        $PID | Set-Content -LiteralPath $PidFile -Encoding ASCII
        try {
            Set-Location $PackRoot
            & $bun run src/server.ts
            exit $LASTEXITCODE
        } finally {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
    }
    'start' { Start-Claw }
    'stop' { Stop-Claw }
    'restart' { Stop-Claw; Start-Claw }
    'restart-defer' {
        if ($DelaySeconds -lt 3) { throw 'DelaySeconds must be at least 3' }
        $args = "-NoProfile -ExecutionPolicy Bypass -Command `"Start-Sleep $DelaySeconds; & '$PSCommandPath' restart`""
        Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden | Out-Null
        Write-Host "Restart scheduled in $DelaySeconds seconds"
    }
    'status' {
        $process = Get-ClawProcess
        if ($process) { Write-Host "Running PID $($process.Id)" } else { Write-Host 'Not running' }
		$task = Get-BridgeTask
		if ($task) {
			$trigger = if ($task.Triggers[0].CimClass.CimClassName -like '*BootTrigger') { 'AtStartup' } else { $task.Triggers[0].CimClass.CimClassName }
			Write-Host "Startup task: $($task.State), trigger=$trigger, user=$($task.Principal.UserId), logon=$($task.Principal.LogonType)"
		} else {
			Write-Host 'Startup task: not installed'
		}
        Write-Host "Log: $LogFile"
        Write-Host "Errors: $ErrorLog"
    }
    'logs' {
        if (Test-Path -LiteralPath $ErrorLog) { Get-Content -LiteralPath $ErrorLog -Tail 30 }
        if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 100 -Wait }
        else { Write-Host "Log does not exist yet: $LogFile" }
    }
    'install' {
		if (-not (Test-IsElevated)) {
			$arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" install"
			Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -WorkingDirectory $PackRoot | Out-Null
			Write-Host 'Administrator installation window opened. Approve UAC to continue.'
			exit 0
		}
		if (-not $Credential) {
			$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
			$Credential = Get-Credential -UserName $currentUser -Message '输入当前 Windows 用户密码，用于开机后在未登录状态运行 Seven Lark Bridge'
		}
		if (-not $Credential -or [string]::IsNullOrWhiteSpace($Credential.GetNetworkCredential().Password)) {
			throw 'A Windows credential with a password is required for startup-before-logon mode.'
		}
		Stop-Claw
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
            "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" run")
		$trigger = New-ScheduledTaskTrigger -AtStartup
        $settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) `
			-ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable `
			-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
		$userName = $Credential.UserName
		$password = $Credential.GetNetworkCredential().Password
		try {
			Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings `
				-User $userName -Password $password -RunLevel Limited `
				-Description 'Seven Lark Bridge with local Codex; starts before interactive logon' -Force | Out-Null
			Remove-Item -LiteralPath (Join-Path $LogDir 'install.error.log') -Force -ErrorAction SilentlyContinue
		} catch {
			$_.Exception.Message | Set-Content -LiteralPath (Join-Path $LogDir 'install.error.log') -Encoding UTF8
			Start-Claw
			throw
		} finally {
			$password = $null
		}
        Start-ScheduledTask -TaskName $TaskName
		Write-Host "Installed and started boot task: $TaskName"
    }
    'uninstall' {
        Stop-Claw
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
		Write-Host "Uninstalled boot task: $TaskName"
    }
}
