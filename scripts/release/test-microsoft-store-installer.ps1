param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path $_ -PathType Leaf })]
  [string]$InstallerPath,

  [string]$ExpectedPublisher = 'CN=DEFAI Private Limited',

  [int]$LaunchSeconds = 8
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path $InstallerPath).Path
$uninstallEntry = $null
$installDirectory = $null
$launchedProcess = $null

function Assert-AuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$PublisherPattern = '',
    [switch]$RequireTimestamp
  )

  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature for ${Path}: $($signature.StatusMessage)"
  }
  if ($PublisherPattern -and $signature.SignerCertificate.Subject -notmatch [regex]::Escape($PublisherPattern)) {
    throw "Unexpected signer for ${Path}: $($signature.SignerCertificate.Subject)"
  }
  if ($RequireTimestamp -and $null -eq $signature.TimeStamperCertificate) {
    throw "Missing trusted timestamp for ${Path}."
  }
}

function Get-AxStudioUninstallEntry {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )

  return @(
    foreach ($root in $roots) {
      Get-ItemProperty $root -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq 'AX Studio' }
    }
  ) | Select-Object -First 1
}

function Get-ExecutablePathFromCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  if ($Command -match '^"([^"]+)"') {
    return $Matches[1]
  }
  return ($Command -split '\s+', 2)[0]
}

function Test-PortableExecutable {
  param([Parameter(Mandatory = $true)][string]$Path)

  try {
    $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
      return $stream.ReadByte() -eq 0x4d -and $stream.ReadByte() -eq 0x5a
    } finally {
      $stream.Dispose()
    }
  } catch {
    throw "Unable to inspect installed file ${Path}: $($_.Exception.Message)"
  }
}

function Invoke-AxStudioUninstall {
  param([Parameter(Mandatory = $true)]$Entry)

  $command = if ($Entry.QuietUninstallString) {
    $Entry.QuietUninstallString
  } else {
    $Entry.UninstallString
  }
  if (-not $command) {
    throw 'AX Studio uninstall registration has no uninstall command.'
  }

  $uninstaller = Get-ExecutablePathFromCommand -Command $command
  $arguments = if ($command -match '^"[^"]+"\s*(.*)$') {
    $Matches[1]
  } else {
    ($command -split '\s+', 2)[1]
  }
  if ($arguments -notmatch '(^|\s)/S($|\s)') {
    $arguments = "$arguments /S".Trim()
  }

  $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Silent uninstall failed with exit code $($process.ExitCode)."
  }
}

Assert-AuthenticodeSignature -Path $installer -PublisherPattern $ExpectedPublisher -RequireTimestamp

try {
  $install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "Silent install failed with exit code $($install.ExitCode)."
  }

  for ($attempt = 0; $attempt -lt 30 -and $null -eq $uninstallEntry; $attempt += 1) {
    $uninstallEntry = Get-AxStudioUninstallEntry
    if ($null -eq $uninstallEntry) { Start-Sleep -Seconds 1 }
  }
  if ($null -eq $uninstallEntry) {
    throw 'AX Studio did not register an uninstall entry after silent installation.'
  }

  $installDirectory = $uninstallEntry.InstallLocation
  if (-not $installDirectory) {
    $uninstaller = Get-ExecutablePathFromCommand -Command $uninstallEntry.UninstallString
    $installDirectory = Split-Path -Parent $uninstaller
  }
  $installDirectory = $installDirectory.Trim('"')
  if (-not (Test-Path $installDirectory -PathType Container)) {
    throw "AX Studio install directory was not found: $installDirectory"
  }

  $portableExecutables = @(
    Get-ChildItem $installDirectory -Recurse -File |
      Where-Object { Test-PortableExecutable -Path $_.FullName }
  )
  if ($portableExecutables.Count -lt 3) {
    throw "Expected the app and bundled sidecars to be installed; found only $($portableExecutables.Count) PE files."
  }
  foreach ($file in $portableExecutables) {
    Assert-AuthenticodeSignature -Path $file.FullName
  }

  $mainExecutable = Get-ChildItem $installDirectory -File -Filter '*.exe' |
    Where-Object { $_.Name -notmatch '(?i)uninstall' } |
    Sort-Object @{ Expression = { if ($_.Name -match '(?i)^AX Studio\.exe$|^ax-studio\.exe$') { 0 } else { 1 } } } |
    Select-Object -First 1
  if ($null -eq $mainExecutable) {
    throw "AX Studio executable was not found in $installDirectory."
  }
  Assert-AuthenticodeSignature -Path $mainExecutable.FullName -PublisherPattern $ExpectedPublisher -RequireTimestamp

  $launchedProcess = Start-Process -FilePath $mainExecutable.FullName -PassThru
  Start-Sleep -Seconds $LaunchSeconds
  if ($launchedProcess.HasExited) {
    throw "AX Studio exited during the ${LaunchSeconds}-second launch smoke test with code $($launchedProcess.ExitCode)."
  }
} finally {
  if ($null -ne $launchedProcess -and -not $launchedProcess.HasExited) {
    taskkill.exe /PID $launchedProcess.Id /T /F | Out-Null
  }
  if ($null -ne $uninstallEntry) {
    Invoke-AxStudioUninstall -Entry $uninstallEntry
  }
}

if ($null -ne (Get-AxStudioUninstallEntry)) {
  throw 'AX Studio uninstall registration remains after silent uninstall.'
}
if ($installDirectory -and (Test-Path $installDirectory)) {
  $remainingApp = Get-ChildItem $installDirectory -File -Filter '*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '(?i)^AX Studio\.exe$|^ax-studio\.exe$' }
  if ($remainingApp) {
    throw "AX Studio executable remains after uninstall: $($remainingApp.FullName)"
  }
}

Write-Host 'Microsoft Store installer smoke test passed.'
