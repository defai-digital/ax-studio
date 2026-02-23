#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$AxFabricAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Ax-Fabric app path: $AxFabricAppPath"
Write-Host "Process name: $ProcessName"
Write-Host "Current working directory: $(Get-Location)"
Write-Host "Contents of current directory:"
Get-ChildItem
Write-Host "Contents of trajectories directory (if exists):"
if (Test-Path "trajectories") {
    Get-ChildItem "trajectories"
} else {
    Write-Host "trajectories directory not found"
}

# Run the main test with proper arguments
if ($AxFabricAppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --app-path "$AxFabricAppPath" --process-name "$ProcessName"
} elseif ($AxFabricAppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --app-path "$AxFabricAppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}
