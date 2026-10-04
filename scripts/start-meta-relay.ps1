$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRelayPath = Join-Path $PSScriptRoot 'meta-webhook-relay.mjs'
$taskListener = Get-NetTCPConnection -LocalPort 3184 -State Listen -ErrorAction SilentlyContinue
if ($taskListener) {
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskListener.OwningProcess)"
    if (!$taskProcess -or !$taskProcess.CommandLine.Contains($taskRelayPath)) {
        throw 'Port 3184 belongs to an unverified process; refusing to replace it.'
    }
    Write-Output "Meta webhook relay already running: PID $($taskProcess.ProcessId)"
    exit 0
}
$taskLogDirectory = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
$taskProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + $taskRelayPath + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogDirectory 'meta-relay.log') -RedirectStandardError (Join-Path $taskLogDirectory 'meta-relay-error.log')
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 100
    $taskListener = Get-NetTCPConnection -LocalPort 3184 -State Listen -ErrorAction SilentlyContinue
    if ($taskListener -and $taskListener.OwningProcess -eq $taskProcess.Id) {
        Set-Content -LiteralPath (Join-Path $taskLogDirectory 'meta-relay.pid') -Value $taskProcess.Id
        Write-Output "Meta webhook relay started: PID $($taskProcess.Id)"
        exit 0
    }
    if ($taskProcess.HasExited) { throw 'Meta webhook relay exited; check data/meta-relay-error.log.' }
}
throw 'Meta webhook relay did not bind port 3184.'
