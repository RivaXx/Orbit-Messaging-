$ErrorActionPreference = 'Stop'
$orbitUrl = 'http://127.0.0.1:4173/'
$orbitRunning = $false
try {
    $orbitHealth = Invoke-RestMethod -Uri ($orbitUrl + '__orbit_health') -TimeoutSec 2
    if ($orbitHealth.app -ne 'orbit-local') { throw 'Port 4173 is used by a different app.' }
    $orbitRunning = $true
} catch { }
if (-not $orbitRunning) {
    $orbitNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $orbitNodePath = if ($orbitNodeCommand) { $orbitNodeCommand.Source } else {
        Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    }
    if (-not (Test-Path -LiteralPath $orbitNodePath)) {
        throw 'Node.js was not found. Install Node.js, then run Start-Orbit.cmd again.'
    }
    $orbitServerPath = Join-Path $PSScriptRoot 'serve.cjs'
    Start-Process -FilePath $orbitNodePath -ArgumentList ('"' + $orbitServerPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($orbitAttempt = 0; $orbitAttempt -lt 20; $orbitAttempt++) {
        Start-Sleep -Milliseconds 150
        try {
            $orbitHealth = Invoke-RestMethod -Uri ($orbitUrl + '__orbit_health') -TimeoutSec 1
            if ($orbitHealth.app -eq 'orbit-local') { $orbitRunning = $true; break }
        } catch { }
    }
    if (-not $orbitRunning) { throw 'Orbit could not start on port 4173. Close the app using that port and try again.' }
}
Start-Process $orbitUrl
