#Requires -Version 5.1
<#
.SYNOPSIS
  Fail-closed Authenticode verification for AX Studio Windows executables.

.DESCRIPTION
  Verifies Status=Valid, DEFAI subject, pinned SHA-1 thumbprint, and trusted
  timestamp. Certificate defaults load from docs/release/windows-cert.json.

.EXAMPLE
  ./scripts/release/verify-windows-authenticode.ps1 -Path .\AX.Studio_2.2.0_x64-setup.exe

.EXAMPLE
  ./scripts/release/verify-windows-authenticode.ps1 -Path .\artifacts -RequireVersion 2.2.0
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Path,

  [string]$RequireVersion = '',

  [string]$ExpectedThumbprint = '',

  [string]$SubjectPattern = '',

  [string]$CertMetadataPath = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-WindowsCertMetadata {
  param([string]$MetadataPath)

  if ([string]::IsNullOrWhiteSpace($MetadataPath)) {
    $MetadataPath = Join-Path (Resolve-RepoRoot) 'docs\release\windows-cert.json'
  }

  if (-not (Test-Path -LiteralPath $MetadataPath -PathType Leaf)) {
    throw "Windows certificate metadata file is missing: $MetadataPath"
  }

  $metadata = Get-Content -LiteralPath $MetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($field in @('thumbprintSha1', 'subjectPattern', 'publisher')) {
    if ([string]::IsNullOrWhiteSpace([string]$metadata.$field)) {
      throw "windows-cert.json is missing required field: $field"
    }
  }

  return $metadata
}

function Normalize-Thumbprint {
  param([string]$Value)
  return ($Value -replace '[\s:]', '').ToUpperInvariant()
}

function Assert-AxStudioAuthenticode {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Thumbprint,
    [Parameter(Mandatory = $true)][string]$Subject,
    [switch]$RequireTimestamp
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "File not found: $FilePath"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
  if ($signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature for ${FilePath}: $($signature.Status) ($($signature.StatusMessage))"
  }

  if ($null -eq $signature.SignerCertificate) {
    throw "Missing signer certificate for $FilePath"
  }

  $actualThumbprint = Normalize-Thumbprint $signature.SignerCertificate.Thumbprint
  if ($actualThumbprint -ne $Thumbprint) {
    throw "Unexpected signer certificate for ${FilePath}. Expected $Thumbprint, got $actualThumbprint"
  }

  if ($signature.SignerCertificate.Subject -notmatch [regex]::Escape($Subject)) {
    throw "Unexpected signer subject for ${FilePath}: $($signature.SignerCertificate.Subject)"
  }

  if ($signature.SignerCertificate.NotAfter -lt [DateTime]::UtcNow) {
    throw "Signer certificate for ${FilePath} expired at $($signature.SignerCertificate.NotAfter.ToUniversalTime().ToString('o'))"
  }

  if ($RequireTimestamp -and $null -eq $signature.TimeStamperCertificate) {
    throw "Missing trusted timestamp for $FilePath"
  }

  Write-Host "Verified $FilePath : $($signature.SignerCertificate.Subject) [$actualThumbprint]"
}

$metadata = Get-WindowsCertMetadata -MetadataPath $CertMetadataPath
$thumbprint = Normalize-Thumbprint $(if ($ExpectedThumbprint) { $ExpectedThumbprint } else { $metadata.thumbprintSha1 })
$subject = if ($SubjectPattern) { $SubjectPattern } else { [string]$metadata.subjectPattern }

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$executables = @()

if (Test-Path -LiteralPath $resolvedPath -PathType Leaf) {
  if ($resolvedPath -notmatch '\.exe$') {
    throw "Path is not an .exe file: $resolvedPath"
  }
  $executables = @(Get-Item -LiteralPath $resolvedPath)
} else {
  $executables = @(Get-ChildItem -LiteralPath $resolvedPath -Filter '*.exe' -File)
  if ($executables.Count -eq 0) {
    throw "No .exe files found under $resolvedPath"
  }
}

if (-not [string]::IsNullOrWhiteSpace($RequireVersion)) {
  if ($RequireVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "RequireVersion must look like 2.2.0, got: $RequireVersion"
  }

  $requiredNames = @(
    "AX.Studio_${RequireVersion}_x64-setup.exe",
    "AX.Studio_${RequireVersion}_arm64-setup.exe"
  )

  $directory = if (Test-Path -LiteralPath $resolvedPath -PathType Container) {
    $resolvedPath
  } else {
    Split-Path -Parent $resolvedPath
  }

  foreach ($name in $requiredNames) {
    $requiredPath = Join-Path $directory $name
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "Required signed Windows installer is missing: $name"
    }
  }
}

foreach ($executable in $executables) {
  Assert-AxStudioAuthenticode `
    -FilePath $executable.FullName `
    -Thumbprint $thumbprint `
    -Subject $subject `
    -RequireTimestamp
}

Write-Host "Authenticode verification passed for $($executables.Count) executable(s)."
