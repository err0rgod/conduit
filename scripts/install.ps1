[CmdletBinding()]
param(
    [string]$Version,
    [switch]$NoSetup
)

$ErrorActionPreference = 'Stop'
$conduitRepository = 'err0rgod/conduit'

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

Assert-Command 'node'
Assert-Command 'npm'
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Conduit requires Node.js 22 or newer; found $(node --version)." }

if (-not $Version) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$conduitRepository/releases/latest" -Headers @{ 'User-Agent' = 'Conduit-Installer' }
    $releaseTag = [string]$release.tag_name
} else {
    $releaseTag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
}
if ($releaseTag -notmatch '^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Invalid Conduit release tag: $releaseTag"
}
$releaseVersion = $releaseTag.Substring(1)
$releaseBase = "https://github.com/$conduitRepository/releases/download/$releaseTag"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "conduit-install-$([guid]::NewGuid().ToString('N'))"
$packageName = "conduit-browser-$releaseVersion.tgz"
$extensionName = "conduit-extension-$releaseVersion.zip"
$packagePath = Join-Path $temporaryRoot $packageName
$extensionArchive = Join-Path $temporaryRoot $extensionName
$checksumsPath = Join-Path $temporaryRoot 'SHA256SUMS'

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Write-Host "Downloading Conduit $releaseTag..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$packageName" -OutFile $packagePath
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$extensionName" -OutFile $extensionArchive
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/SHA256SUMS" -OutFile $checksumsPath
    Assert-Checksum $packagePath $checksumsPath
    Assert-Checksum $extensionArchive $checksumsPath

    $conduitDataRoot = Join-Path $env:LOCALAPPDATA 'Conduit'
    $npmRoot = Join-Path $conduitDataRoot 'App'
    $binRoot = Join-Path $conduitDataRoot 'bin'
    $extensionRoot = Join-Path $conduitDataRoot "Extension\$releaseVersion"
    New-Item -ItemType Directory -Force -Path $npmRoot, $binRoot, $extensionRoot | Out-Null

    & npm install --prefix $npmRoot --omit=dev --no-audit --no-fund $packagePath
    if ($LASTEXITCODE -ne 0) { throw 'npm failed to install the Conduit backend package.' }
    Expand-Archive -LiteralPath $extensionArchive -DestinationPath $extensionRoot -Force

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

    Write-Host "Conduit $releaseTag installed without administrator access." -ForegroundColor Green
    Write-Host "Extension folder: $extensionRoot" -ForegroundColor Magenta
    Write-Host 'Load that folder from chrome://extensions or edge://extensions using Developer mode.'
    if ($NoSetup) { Write-Host 'Run conduit setup before loading the extension.' }
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
