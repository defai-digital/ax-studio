#!/usr/bin/env pwsh
# Windows post-test cleanup script

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning up after tests..."

# Kill any running Ax-Studio processes (both regular and nightly)
Get-Process -Name "Ax-Studio" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-studio" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Ax-Studio-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-studio-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Ax-Studio data folders (both regular and nightly)
$axStudioAppData = "$env:APPDATA\Ax-Studio"
$axStudioNightlyAppData = "$env:APPDATA\Ax-Studio-nightly"
$axStudioLocalAppData = "$env:LOCALAPPDATA\ai.axstudio.app"
$axStudioNightlyLocalAppData = "$env:LOCALAPPDATA\ax-studio-nightly.ai.app"
$axStudioProgramsPath = "$env:LOCALAPPDATA\Programs\Ax-Studio"
$axStudioNightlyProgramsPath = "$env:LOCALAPPDATA\Programs\Ax-Studio-nightly"

if (Test-Path $axStudioAppData) {
    Write-Host "Removing $axStudioAppData"
    Remove-Item -Path $axStudioAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axStudioNightlyAppData) {
    Write-Host "Removing $axStudioNightlyAppData"
    Remove-Item -Path $axStudioNightlyAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axStudioLocalAppData) {
    Write-Host "Removing $axStudioLocalAppData"
    Remove-Item -Path $axStudioLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axStudioNightlyLocalAppData) {
    Write-Host "Removing $axStudioNightlyLocalAppData"
    Remove-Item -Path $axStudioNightlyLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axStudioProgramsPath) {
    Write-Host "Removing $axStudioProgramsPath"
    Remove-Item -Path $axStudioProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $axStudioNightlyProgramsPath) {
    Write-Host "Removing $axStudioNightlyProgramsPath"
    Remove-Item -Path $axStudioNightlyProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove Ax-Studio extensions folder
$axStudioExtensionsPath = "$env:USERPROFILE\ax-studio\extensions"
if (Test-Path $axStudioExtensionsPath) {
    Write-Host "Removing $axStudioExtensionsPath"
    Remove-Item -Path $axStudioExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Try to uninstall Ax-Studio app silently
try {
    $isNightly = [System.Convert]::ToBoolean($IsNightly)

    # Determine uninstaller path based on nightly flag
    if ($isNightly) {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\ax-studio-nightly\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\ax-studio-nightly"
    } else {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\ax-studio\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\ax-studio"
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

    Write-Host "Ax-Studio app cleanup completed"
}
catch {
    Write-Warning "Failed to uninstall Ax-Studio app cleanly: $_"
    Write-Host "Manual cleanup may be required"
}

# Clean up downloaded installer
$installerPath = "$env:TEMP\ax-studio-installer.exe"
if (Test-Path $installerPath) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed"
