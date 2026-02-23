#!/usr/bin/env pwsh
# Windows cleanup script for Ax-Fabric app

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning existing Ax-Fabric installations..."

# Remove Ax-Fabric data folders (both regular and nightly)
$axFabricAppData = "$env:APPDATA\Ax-Fabric"
$axFabricNightlyAppData = "$env:APPDATA\Ax-Fabric-nightly"
$axFabricLocalAppData = "$env:LOCALAPPDATA\ai.axfabric.app"
$axFabricNightlyLocalAppData = "$env:LOCALAPPDATA\ax-fabric-nightly.ai.app"

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


# Kill any running Ax-Fabric processes (both regular and nightly)
Get-Process -Name "Ax-Fabric" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-fabric" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Ax-Fabric-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ax-fabric-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Ax-Fabric extensions folder
$axFabricExtensionsPath = "$env:USERPROFILE\ax-fabric\extensions"
if (Test-Path $axFabricExtensionsPath) {
    Write-Host "Removing $axFabricExtensionsPath"
    Remove-Item -Path $axFabricExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Ax-Fabric cleanup completed"
