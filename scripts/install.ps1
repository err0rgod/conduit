[CmdletBinding()]
param(
    [string]$Version,
    [switch]$NoSetup
)

$ErrorActionPreference = 'Stop'
$conduitRepository = 'err0rgod/conduit'
$skillDirectoryUrl = 'https://github.com/err0rgod/skills/tree/main/conduit'
$skillEntryUrl = 'https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md'
$extensionReleaseUrl = 'https://github.com/err0rgod/conduit-extension/releases/tag/v0.1.3'
$extensionArchiveUrl = 'https://github.com/err0rgod/conduit-extension/releases/download/v0.1.3/conduit-extension-unpacked-v0.1.3.zip'
$edgeStoreUrl = 'https://microsoftedge.microsoft.com/addons/search/conduit'
$firefoxStoreUrl = 'https://addons.mozilla.org/firefox/search/?q=Conduit'

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Install Node.js 22 or newer from https://nodejs.org/ and retry."
    }
}

function Assert-Checksum([string]$FilePath, [string]$ChecksumsPath) {
    $fileName = [IO.Path]::GetFileName($FilePath)
    $line = Get-Content -LiteralPath $ChecksumsPath | Where-Object { $_ -match "^[a-f0-9]{64}\s+$([regex]::Escape($fileName))$" } | Select-Object -First 1
    if (-not $line) { throw "SHA256SUMS does not contain $fileName." }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum verification failed for $fileName." }
}

function Resolve-ReleaseTag([string]$Repository, [string]$RequestedVersion, [string]$ComponentName) {
    if (-not $RequestedVersion) {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ 'User-Agent' = 'Conduit-Installer' }
        $tag = [string]$release.tag_name
    } else {
        $tag = if ($RequestedVersion.StartsWith('v')) { $RequestedVersion } else { "v$RequestedVersion" }
    }
    if ($tag -notmatch '^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
        throw "Invalid $ComponentName release tag: $tag"
    }
    return $tag
}

Assert-Command 'node'
Assert-Command 'npm'
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Conduit requires Node.js 22 or newer; found $(node --version)." }

$releaseTag = Resolve-ReleaseTag $conduitRepository $Version 'Conduit'
$releaseVersion = $releaseTag.Substring(1)
$releaseBase = "https://github.com/$conduitRepository/releases/download/$releaseTag"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "conduit-install-$([guid]::NewGuid().ToString('N'))"
$packageName = "conduit-browser-$releaseVersion.tgz"
$packagePath = Join-Path $temporaryRoot $packageName
$backendChecksumsPath = Join-Path $temporaryRoot 'SHA256SUMS'

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Write-Host "Downloading Conduit backend $releaseTag..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$packageName" -OutFile $packagePath
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/SHA256SUMS" -OutFile $backendChecksumsPath
    Assert-Checksum $packagePath $backendChecksumsPath

    $conduitDataRoot = Join-Path $env:LOCALAPPDATA 'Conduit'
    $npmRoot = Join-Path $conduitDataRoot 'App'
    $binRoot = Join-Path $conduitDataRoot 'bin'
    New-Item -ItemType Directory -Force -Path $npmRoot, $binRoot | Out-Null

    & npm install --prefix $npmRoot --omit=dev --no-audit --no-fund $packagePath
    if ($LASTEXITCODE -ne 0) { throw 'npm failed to install the Conduit backend package.' }
    $cliPath = Join-Path $npmRoot 'node_modules\conduit-browser\dist\cli.cjs'
    if (-not (Test-Path -LiteralPath $cliPath)) { throw 'The installed Conduit CLI is missing.' }
    $nodePath = (Get-Command node).Source
    $launcherPath = Join-Path $binRoot 'conduit.cmd'
    Set-Content -LiteralPath $launcherPath -Encoding Ascii -Value "@echo off`r`n`"$nodePath`" `"$cliPath`" %*"

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathEntries = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($pathEntries | Where-Object { $_.TrimEnd('\') -ieq $binRoot.TrimEnd('\') })) {
        [Environment]::SetEnvironmentVariable('Path', (($pathEntries + $binRoot) -join ';'), 'User')
    }
    $env:Path = "$binRoot;$env:Path"

    if (-not $NoSetup) {
        & node $cliPath setup
        if ($LASTEXITCODE -ne 0) { throw 'Conduit was installed, but conduit setup failed.' }
    }

    Write-Host "Conduit backend $releaseTag installed without administrator access." -ForegroundColor Green
    Write-Host 'Next: install Conduit Extension from the verified GitHub unpacked release.' -ForegroundColor Magenta
    Write-Host "Chrome and Brave download: $extensionArchiveUrl"
    Write-Host "Release page: $extensionReleaseUrl"
    Write-Host 'Extract the ZIP, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the folder containing manifest.json.'
    Write-Host "Microsoft Edge: $edgeStoreUrl"
    Write-Host "Firefox: $firefoxStoreUrl"
    Write-Host 'The unpacked development extension ID is trusted by default.'
    Write-Host 'For a future store listing, run conduit extension trust <extension-id> once.'
    Write-Host "Agent Skill directory: $skillDirectoryUrl" -ForegroundColor Cyan
    Write-Host "Agent Skill entry: $skillEntryUrl" -ForegroundColor Cyan
    Write-Host 'Use the skill directory or SKILL.md URL with any Agent Skills-compatible AI harness.'
    if ($NoSetup) { Write-Host 'Run conduit setup before installing the extension.' }
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
