#!/usr/bin/env bash
set -e

CONDUIT_DIR="$HOME/.conduit"
APP_DIR="$CONDUIT_DIR/app"

echo -e "\033[0;36m===================================================\033[0m"
echo -e "\033[0;36m INSTALLING CONDUIT...\033[0m"
echo -e "\033[0;36m===================================================\033[0m"

# 1. Check for Node.js
NEEDS_NODE=false
if ! command -v node >/dev/null 2>&1; then
    NEEDS_NODE=true
else
    NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
    if [ "$NODE_VERSION" -lt 22 ]; then
        echo -e "\033[0;33mNode.js $(node -v) is too old. Conduit requires Node.js 22+.\033[0m"
        NEEDS_NODE=true
    fi
fi

if [ "$NEEDS_NODE" = true ]; then
    echo -e "\033[0;33mAttempting to install/update Node.js via package manager...\033[0m"
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v brew >/dev/null 2>&1; then
        brew install node
    else
        echo -e "\033[0;31mCould not automatically install Node.js. Please install Node 22+ from https://nodejs.org/\033[0m"
        exit 1
    fi
fi
echo -e "\033[0;32m✅ Node.js is ready.\033[0m"

# 2. Check for Git
if ! command -v git >/dev/null 2>&1; then
    echo -e "\033[0;33mGit not found. Attempting to install...\033[0m"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y git
    elif command -v brew >/dev/null 2>&1; then
        brew install git
    else
        echo -e "\033[0;31mCould not automatically install Git. Please install it from https://git-scm.com/\033[0m"
        exit 1
    fi
fi
echo -e "\033[0;32m Git is installed.\033[0m"

# 3. Clone or Update Repositories
mkdir -p "$CONDUIT_DIR"

EXT_DIR="$CONDUIT_DIR/extension"

if [ -d "$APP_DIR" ]; then
    echo -e "\033[0;33mUpdating existing Conduit repository...\033[0m"
    cd "$APP_DIR"
    git pull origin main
else
    echo -e "\033[0;33mCloning Conduit repository...\033[0m"
    cd "$CONDUIT_DIR"
    git clone https://github.com/err0rgod/conduit.git app
fi

if [ -d "$EXT_DIR" ]; then
    echo -e "\033[0;33mUpdating existing Conduit Extension repository...\033[0m"
    cd "$EXT_DIR"
    git pull origin main
else
    echo -e "\033[0;33mCloning Conduit Extension repository...\033[0m"
    cd "$CONDUIT_DIR"
    git clone https://github.com/err0rgod/conduit-extension.git extension
fi

# 4. Install Dependencies & Build
echo -e "\033[0;33mInstalling dependencies using pnpm...\033[0m"
# Ensure pnpm is available
if ! command -v pnpm >/dev/null 2>&1; then
    echo -e "\033[0;33mpnpm not found. Installing pnpm globally...\033[0m"
    npm install -g pnpm
fi

echo -e "\033[0;33mBuilding Conduit (Daemon/CLI)...\033[0m"
cd "$APP_DIR"
npx pnpm install
npx pnpm build

echo -e "\033[0;33mBuilding Conduit Extension...\033[0m"
cd "$EXT_DIR"
npx pnpm install
npx pnpm build

# 5. Run Setup
echo -e "\033[0;33mConfiguring system...\033[0m"
cd "$APP_DIR"
node packages/cli/bin/conduit.js setup

# 6. Success Output
EXT_PATH="$EXT_DIR/apps/extension/dist"

echo ""
echo -e "\033[0;36m===================================================\033[0m"
echo -e "\033[0;32m CONDUIT INSTALLED SUCCESSFULLY! \033[0m"
echo -e "\033[0;36m===================================================\033[0m"
echo "The Conduit Daemon is running in the background."
echo ""
echo -e "\033[0;33mFinal Step: Connect your browser\033[0m"
echo "1. Open your browser and go to: chrome://extensions or edge://extensions"
echo "2. Turn on 'Developer mode' (top right corner)."
echo "3. Click 'Load unpacked'."
echo "4. Copy and paste this exact path:"
echo -e "     \033[0;35m$EXT_PATH\033[0m"
echo ""
echo "The extension will connect automatically."
echo -e "\033[0;36m===================================================\033[0m"
