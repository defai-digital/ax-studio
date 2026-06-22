param (
  [string]$Target
)

$requiredEnv = @(
  "AZURE_KEY_VAULT_URI",
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CERT_NAME"
)

foreach ($name in $requiredEnv) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    Write-Warning "Skipping Windows code signing because $name is not configured."
    exit 0
  }
}

if (-not (Get-Command AzureSignTool.exe -ErrorAction SilentlyContinue)) {
  Write-Warning "Skipping Windows code signing because AzureSignTool.exe is not available."
  exit 0
}

AzureSignTool.exe sign `
  -tr http://timestamp.digicert.com `
  -kvu $env:AZURE_KEY_VAULT_URI `
  -kvi $env:AZURE_CLIENT_ID `
  -kvt $env:AZURE_TENANT_ID `
  -kvs $env:AZURE_CLIENT_SECRET `
  -kvc $env:AZURE_CERT_NAME `
  -v $Target
