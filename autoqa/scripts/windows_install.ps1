#!/usr/bin/env pwsh
# Windows install script for Ax-Studio app

param(
    [string]$IsNightly = "false"
)

$installerPath = "$env:TEMP\ax-studio-installer.exe"
$isNightly = [System.Convert]::ToBoolean($IsNightly)

Write-Host "Installing Ax-Studio app..."
Write-Host "Is nightly build: $isNightly"

# Try silent installation first
try {
    Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
    Write-Host "Ax-Studio app installed silently"
}
catch {
    Write-Host "Silent installation failed, trying normal installation..."
    Start-Process -FilePath $installerPath -Wait -NoNewWindow
}

# Wait a bit for installation to complete
Start-Sleep -Seconds 10

Write-Host "[INFO] Waiting for Ax-Studio app first initialization (120 seconds)..."
Write-Host "This allows Ax-Studio to complete its initial setup and configuration"
Start-Sleep -Seconds 120
Write-Host "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if ($isNightly) {
    $defaultAxStudioPath = "$env:LOCALAPPDATA\Programs\ax-studio-nightly\Ax-Studio-nightly.exe"
    $processName = "Ax-Studio-nightly.exe"
} else {
    $defaultAxStudioPath = "$env:LOCALAPPDATA\Programs\ax-studio\Ax-Studio.exe"
    $processName = "Ax-Studio.exe"
}

if (Test-Path $defaultAxStudioPath) {
    Write-Host "Ax-Studio app installed successfully at: $defaultAxStudioPath"
    Write-Output "AX_STUDIO_APP_PATH=$defaultAxStudioPath" >> $env:GITHUB_ENV
    Write-Output "AX_STUDIO_PROCESS_NAME=$processName" >> $env:GITHUB_ENV
} else {
    Write-Warning "Ax-Studio app not found at expected location: $defaultAxStudioPath"
    Write-Host "Will auto-detect during test run"
}
