#!/usr/bin/env pwsh
# Windows install script for Ax-Fabric app

param(
    [string]$IsNightly = "false"
)

$installerPath = "$env:TEMP\ax-fabric-installer.exe"
$isNightly = [System.Convert]::ToBoolean($IsNightly)

Write-Host "Installing Ax-Fabric app..."
Write-Host "Is nightly build: $isNightly"

# Try silent installation first
try {
    Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
    Write-Host "Ax-Fabric app installed silently"
}
catch {
    Write-Host "Silent installation failed, trying normal installation..."
    Start-Process -FilePath $installerPath -Wait -NoNewWindow
}

# Wait a bit for installation to complete
Start-Sleep -Seconds 10

Write-Host "[INFO] Waiting for Ax-Fabric app first initialization (120 seconds)..."
Write-Host "This allows Ax-Fabric to complete its initial setup and configuration"
Start-Sleep -Seconds 120
Write-Host "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if ($isNightly) {
    $defaultAxFabricPath = "$env:LOCALAPPDATA\Programs\ax-fabric-nightly\Ax-Fabric-nightly.exe"
    $processName = "Ax-Fabric-nightly.exe"
} else {
    $defaultAxFabricPath = "$env:LOCALAPPDATA\Programs\ax-fabric\Ax-Fabric.exe"
    $processName = "Ax-Fabric.exe"
}

if (Test-Path $defaultAxFabricPath) {
    Write-Host "Ax-Fabric app installed successfully at: $defaultAxFabricPath"
    Write-Output "AX_FABRIC_APP_PATH=$defaultAxFabricPath" >> $env:GITHUB_ENV
    Write-Output "AX_FABRIC_PROCESS_NAME=$processName" >> $env:GITHUB_ENV
} else {
    Write-Warning "Ax-Fabric app not found at expected location: $defaultAxFabricPath"
    Write-Host "Will auto-detect during test run"
}
