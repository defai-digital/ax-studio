#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$AxStudioAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Ax-Studio app path: $AxStudioAppPath"
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
if ($AxStudioAppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --app-path "$AxStudioAppPath" --process-name "$ProcessName"
} elseif ($AxStudioAppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --app-path "$AxStudioAppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}
