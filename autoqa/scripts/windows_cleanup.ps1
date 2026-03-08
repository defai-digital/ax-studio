#!/usr/bin/env pwsh
# Windows cleanup script for Ax-Studio app

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning existing Ax-Studio installations..."

# Remove Ax-Studio data folders (both regular and nightly)
$axStudioAppData = "$env:APPDATA\Ax-Studio"
$axStudioNightlyAppData = "$env:APPDATA\Ax-Studio-nightly"
$axStudioLocalAppData = "$env:LOCALAPPDATA\ai.axstudio.app"
$axStudioNightlyLocalAppData = "$env:LOCALAPPDATA\ax-studio-nightly.ai.app"

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


# Kill any running Ax-Studio processes (both regular and nightly)
Get-Process -Name "Ax-Studio" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-studio" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Ax-Studio-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-studio-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Ax-Studio extensions folder
$axStudioExtensionsPath = "$env:USERPROFILE\ax-studio\extensions"
if (Test-Path $axStudioExtensionsPath) {
    Write-Host "Removing $axStudioExtensionsPath"
    Remove-Item -Path $axStudioExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Ax-Studio cleanup completed"
