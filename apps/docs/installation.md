# Installation

Conduit is currently installed from source. No npm package or browser-store release is published yet.

```bash
git clone https://github.com/err0rgod/conduit.git
cd conduit
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## Load the Chromium extension

```bash
node packages/cli/bin/conduit.js extension path
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the printed `apps/extension/dist` directory.
5. Run `conduit extension token` locally and copy the token into the extension popup.
6. Confirm the daemon port, normally `9222`, and save.

The production manifest requests `tabs`, `scripting`, and `storage`. Broad host access is optional. The `debugger` and `downloads` capabilities are optional and requested only for operations that need them.

## Run the CLI conveniently

During development use `node packages/cli/bin/conduit.js`. You may also link the workspace package locally:

```bash
pnpm --filter @conduit/cli link --global
conduit --help
```

Global linking is optional and may depend on your pnpm home configuration.

## Upgrade

Stop the daemon, pull the desired commit, perform a frozen install, rebuild, and reload the unpacked extension:

```bash
conduit stop
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
```
