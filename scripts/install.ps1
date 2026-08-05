# Conduit Windows Installation Script
$ErrorActionPreference = "Stop"

$conduitDir = Join-Path $HOME ".conduit"
$appDir = Join-Path $conduitDir "app"

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "INSTALLING CONDUIT..." -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# 1. Check for Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Installing Node.js via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "Failed to install Node.js automatically. Please install it from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
}
Write-Host "Node.js is installed." -ForegroundColor Green

# 2. Check for Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git not found. Installing Git via winget..." -ForegroundColor Yellow
    winget install Git.Git --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "Failed to install Git automatically. Please install it from https://git-scm.com/" -ForegroundColor Red
        exit 1
    }
}
Write-Host "Git is installed." -ForegroundColor Green

# 3. Clone or Update Repositories
if (-not (Test-Path $conduitDir)) {
    New-Item -ItemType Directory -Path $conduitDir | Out-Null
}

$extensionDir = Join-Path $conduitDir "extension"

if (Test-Path $appDir) {
    Write-Host "Updating existing Conduit repository..." -ForegroundColor Yellow
    Set-Location $appDir
    git pull origin main
} else {
    Write-Host "Cloning Conduit repository..." -ForegroundColor Yellow
    Set-Location $conduitDir
    git clone https://github.com/err0rgod/conduit.git app
}

if (Test-Path $extensionDir) {
    Write-Host "Updating existing Conduit Extension repository..." -ForegroundColor Yellow
    Set-Location $extensionDir
    git pull origin main
} else {
    Write-Host "Cloning Conduit Extension repository..." -ForegroundColor Yellow
    Set-Location $conduitDir
    git clone https://github.com/err0rgod/conduit-extension.git extension
}

# 4. Install Dependencies & Build
Write-Host "Installing dependencies using pnpm..." -ForegroundColor Yellow
# Ensure pnpm is available
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "pnpm not found. Installing pnpm globally..." -ForegroundColor Yellow
    npm install -g pnpm
}

Write-Host "Building Conduit (Daemon/CLI)..." -ForegroundColor Yellow
Set-Location $appDir
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to install dependencies" -ForegroundColor Red; exit 1 }
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build Conduit" -ForegroundColor Red; exit 1 }

Write-Host "Building Conduit Extension..." -ForegroundColor Yellow
Set-Location $extensionDir
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to install extension dependencies" -ForegroundColor Red; exit 1 }
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build Extension" -ForegroundColor Red; exit 1 }

# 5. Run Setup
Write-Host "Configuring system..." -ForegroundColor Yellow
Set-Location $appDir
node packages/cli/bin/conduit.js setup

# 6. Success Output
$extPath = Join-Path $extensionDir "apps\extension\dist"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "CONDUIT INSTALLED SUCCESSFULLY! " -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "The Conduit Daemon is running in the background."
Write-Host ""
Write-Host "Final Step: Connect your browser" -ForegroundColor Yellow
Write-Host "1. Open your browser and go to: chrome://extensions or edge://extensions"
Write-Host "2. Turn on 'Developer mode' (top right corner)."
Write-Host "3. Click 'Load unpacked'."
Write-Host "4. Copy and paste this exact path:"
Write-Host " $extPath" -ForegroundColor Magenta
Write-Host ""
Write-Host "The extension will connect automatically."
Write-Host "===================================================" -ForegroundColor Cyan
