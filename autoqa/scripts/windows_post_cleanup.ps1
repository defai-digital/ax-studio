#!/usr/bin/env pwsh
# Windows post-test cleanup script

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning up after tests..."

# Kill any running Ax-Fabric processes (both regular and nightly)
Get-Process -Name "Ax-Fabric" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-fabric" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Ax-Fabric-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-fabric-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Ax-Fabric data folders (both regular and nightly)
$axFabricAppData = "$env:APPDATA\Ax-Fabric"
$axFabricNightlyAppData = "$env:APPDATA\Ax-Fabric-nightly"
$axFabricLocalAppData = "$env:LOCALAPPDATA\ai.axfabric.app"
$axFabricNightlyLocalAppData = "$env:LOCALAPPDATA\ax-fabric-nightly.ai.app"
$axFabricProgramsPath = "$env:LOCALAPPDATA\Programs\Ax-Fabric"
$axFabricNightlyProgramsPath = "$env:LOCALAPPDATA\Programs\Ax-Fabric-nightly"

if (Test-Path $axFabricAppData) {
    Write-Host "Removing $axFabricAppData"
    Remove-Item -Path $axFabricAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axFabricNightlyAppData) {
    Write-Host "Removing $axFabricNightlyAppData"
    Remove-Item -Path $axFabricNightlyAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axFabricLocalAppData) {
    Write-Host "Removing $axFabricLocalAppData"
    Remove-Item -Path $axFabricLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axFabricNightlyLocalAppData) {
    Write-Host "Removing $axFabricNightlyLocalAppData"
    Remove-Item -Path $axFabricNightlyLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axFabricProgramsPath) {
    Write-Host "Removing $axFabricProgramsPath"
    Remove-Item -Path $axFabricProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axFabricNightlyProgramsPath) {
    Write-Host "Removing $axFabricNightlyProgramsPath"
    Remove-Item -Path $axFabricNightlyProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove Ax-Fabric extensions folder
$axFabricExtensionsPath = "$env:USERPROFILE\ax-fabric\extensions"
if (Test-Path $axFabricExtensionsPath) {
    Write-Host "Removing $axFabricExtensionsPath"
    Remove-Item -Path $axFabricExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Try to uninstall Ax-Fabric app silently
try {
    $isNightly = [System.Convert]::ToBoolean($IsNightly)

    # Determine uninstaller path based on nightly flag
    if ($isNightly) {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\ax-fabric-nightly\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\ax-fabric-nightly"
    } else {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\ax-fabric\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\ax-fabric"
    }

    Write-Host "Looking for uninstaller at: $uninstallerPath"

    if (Test-Path $uninstallerPath) {
        Write-Host "Found uninstaller, attempting silent uninstall..."
        Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -Wait -NoNewWindow -ErrorAction SilentlyContinue
        Write-Host "Uninstall completed"
    } else {
        Write-Host "No uninstaller found, attempting manual cleanup..."

        if (Test-Path $installPath) {
            Write-Host "Removing installation directory: $installPath"
            Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Ax-Fabric app cleanup completed"
}
catch {
    Write-Warning "Failed to uninstall Ax-Fabric app cleanly: $_"
    Write-Host "Manual cleanup may be required"
}

# Clean up downloaded installer
$installerPath = "$env:TEMP\ax-fabric-installer.exe"
if (Test-Path $installerPath) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed"
