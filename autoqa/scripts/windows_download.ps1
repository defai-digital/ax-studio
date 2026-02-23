#!/usr/bin/env pwsh
# Windows download script for Ax-Fabric app

param(
    [string]$WorkflowInputUrl = "",
    [string]$WorkflowInputIsNightly = "",
    [string]$RepoVariableUrl = "",
    [string]$RepoVariableIsNightly = "",
    [string]$DefaultUrl = "",
    [string]$DefaultIsNightly = ""
)

# Determine Ax-Fabric app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable AX_FABRIC_APP_URL
# 3. Default URL from env

$axFabricAppUrl = ""
$isNightly = $false

if ($WorkflowInputUrl -ne "") {
    $axFabricAppUrl = $WorkflowInputUrl
    $isNightly = [System.Convert]::ToBoolean($WorkflowInputIsNightly)
    Write-Host "Using Ax-Fabric app URL from workflow input: $axFabricAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
elseif ($RepoVariableUrl -ne "") {
    $axFabricAppUrl = $RepoVariableUrl
    $isNightly = [System.Convert]::ToBoolean($RepoVariableIsNightly)
    Write-Host "Using Ax-Fabric app URL from repository variable: $axFabricAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
else {
    $axFabricAppUrl = $DefaultUrl
    $isNightly = [System.Convert]::ToBoolean($DefaultIsNightly)
    Write-Host "Using default Ax-Fabric app URL: $axFabricAppUrl"
    Write-Host "Is nightly build: $isNightly"
}

# Set environment variables for later steps
Write-Output "AX_FABRIC_APP_URL=$axFabricAppUrl" >> $env:GITHUB_ENV
Write-Output "IS_NIGHTLY=$isNightly" >> $env:GITHUB_ENV

Write-Host "Downloading Ax-Fabric app from: $axFabricAppUrl"

$downloadPath = "$env:TEMP\ax-fabric-installer.exe"

try {
    # Use wget for better performance
    wget.exe "$axFabricAppUrl" -O "$downloadPath"

    if (Test-Path $downloadPath) {
        $fileSize = (Get-Item $downloadPath).Length
        Write-Host "Downloaded Ax-Fabric app successfully. Size: $fileSize bytes"
        Write-Host "File saved to: $downloadPath"
    } else {
        throw "Downloaded file not found"
    }
}
catch {
    Write-Error "Failed to download Ax-Fabric app: $_"
    exit 1
}
