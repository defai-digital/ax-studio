[CmdletBinding()]
param (
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Target
)

$ErrorActionPreference = "Stop"

function Get-WindowsCertMetadata {
  $metadataPath = Join-Path $PSScriptRoot "..\docs\release\windows-cert.json"
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "Windows certificate metadata file is missing: $metadataPath"
  }

  $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($field in @("thumbprintSha1", "timestampUrl", "description", "productUrl")) {
    if ([string]::IsNullOrWhiteSpace([string]$metadata.$field)) {
      throw "windows-cert.json is missing required field: $field"
    }
  }

  return $metadata
}

function Normalize-Thumbprint {
  param([string]$Value)
  return ($Value -replace "[\s:]", "").ToUpperInvariant()
}

$certMetadata = Get-WindowsCertMetadata
$expectedThumbprint = Normalize-Thumbprint $certMetadata.thumbprintSha1
$timestampUrl = [string]$certMetadata.timestampUrl
$description = [string]$certMetadata.description
$productUrl = [string]$certMetadata.productUrl

$requiredEnv = @(
  "AZURE_KEY_VAULT_URI",
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CERT_NAME"
)

$missingEnv = @(
  $requiredEnv | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
  }
)

if ($missingEnv.Count -gt 0) {
  throw "Windows code signing is required, but these variables are missing: $($missingEnv -join ', ')"
}

if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
  throw "Windows code signing target does not exist: $Target"
}

$azureSignTool = Get-Command AzureSignTool.exe -ErrorAction SilentlyContinue
if (-not $azureSignTool) {
  throw "Windows code signing is required, but AzureSignTool.exe is not available."
}

& $azureSignTool.Source sign `
  -fd sha256 `
  -tr $timestampUrl `
  -td sha256 `
  -kvu $env:AZURE_KEY_VAULT_URI `
  -kvi $env:AZURE_CLIENT_ID `
  -kvt $env:AZURE_TENANT_ID `
  -kvs $env:AZURE_CLIENT_SECRET `
  -kvc $env:AZURE_CERT_NAME `
  -d $description `
  -du $productUrl `
  -v $Target

if ($LASTEXITCODE -ne 0) {
  throw "AzureSignTool failed for $Target with exit code $LASTEXITCODE."
}

$signature = Get-AuthenticodeSignature -LiteralPath $Target
if ($signature.Status -ne "Valid") {
  throw "Authenticode verification failed for $Target with status $($signature.Status)."
}

$actualThumbprint = Normalize-Thumbprint $signature.SignerCertificate.Thumbprint
if ($actualThumbprint -ne $expectedThumbprint) {
  throw "Unexpected Windows signing certificate for $Target. Expected $expectedThumbprint, got $actualThumbprint."
}

Write-Host "Successfully signed and verified $Target with certificate $actualThumbprint."
