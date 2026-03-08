#!/usr/bin/env pwsh
# Windows download script for Ax-Studio app

param(
    [string]$WorkflowInputUrl = "",
    [string]$WorkflowInputIsNightly = "",
    [string]$RepoVariableUrl = "",
    [string]$RepoVariableIsNightly = "",
    [string]$DefaultUrl = "",
    [string]$DefaultIsNightly = ""
)

# Determine Ax-Studio app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable AX_STUDIO_APP_URL
# 3. Default URL from env

$axStudioAppUrl = ""
$isNightly = $false

if ($WorkflowInputUrl -ne "") {
    $axStudioAppUrl = $WorkflowInputUrl
    $isNightly = [System.Convert]::ToBoolean($WorkflowInputIsNightly)
    Write-Host "Using Ax-Studio app URL from workflow input: $axStudioAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
elseif ($RepoVariableUrl -ne "") {
    $axStudioAppUrl = $RepoVariableUrl
    $isNightly = [System.Convert]::ToBoolean($RepoVariableIsNightly)
    Write-Host "Using Ax-Studio app URL from repository variable: $axStudioAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
else {
    $axStudioAppUrl = $DefaultUrl
    $isNightly = [System.Convert]::ToBoolean($DefaultIsNightly)
    Write-Host "Using default Ax-Studio app URL: $axStudioAppUrl"
    Write-Host "Is nightly build: $isNightly"
}

# Set environment variables for later steps
Write-Output "AX_STUDIO_APP_URL=$axStudioAppUrl" >> $env:GITHUB_ENV
Write-Output "IS_NIGHTLY=$isNightly" >> $env:GITHUB_ENV

Write-Host "Downloading Ax-Studio app from: $axStudioAppUrl"

$downloadPath = "$env:TEMP\ax-studio-installer.exe"

try {
    # Use wget for better performance
    wget.exe "$axStudioAppUrl" -O "$downloadPath"

    if (Test-Path $downloadPath) {
        $fileSize = (Get-Item $downloadPath).Length
        Write-Host "Downloaded Ax-Studio app successfully. Size: $fileSize bytes"
        Write-Host "File saved to: $downloadPath"
    } else {
        throw "Downloaded file not found"
    }
}
catch {
    Write-Error "Failed to download Ax-Studio app: $_"
    exit 1
}
