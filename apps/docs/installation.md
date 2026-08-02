# Installation

Conduit is currently installed from source. No npm package or browser-store release is published yet.

```bash
git clone https://github.com/err0rgod/conduit.git
cd conduit
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## Test the release package

Maintainers can build and install the self-contained consumer tarball before it is
published:

```bash
pnpm distribution:pack
npm install --global ./artifacts/conduit-browser-0.1.0.tgz
conduit --help
conduit setup
```

The tarball contains the CLI, daemon, MCP adapter, and built extension. CI installs
it outside the monorepo and verifies the installed daemon lifecycle. Normal users
should wait for the signed npm release instead of installing an arbitrary artifact.

`conduit setup` is the normal post-install command. It initializes secure local
state, installs automatic startup for only the current user, starts the daemon, and
prints the unpacked extension path. It does not require administrator rights.

| Platform | User-level startup mechanism                   |
| -------- | ---------------------------------------------- |
| Windows  | Current-user `HKCU\\...\\Run` entry at sign-in |
| macOS    | LaunchAgent in `~/Library/LaunchAgents`        |
| Linux    | systemd user unit in `~/.config/systemd/user`  |

Use `conduit setup --no-service` to manage startup yourself or
`conduit setup --no-start` to configure without starting immediately.

## Load the Chromium extension

```bash
node packages/cli/bin/conduit.js extension path
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the printed `apps/extension/dist` directory.
5. Run `conduit extension pair` locally.
6. Enter the one-use code and daemon port, normally `9222`, in the extension popup.

The production manifest requests `tabs`, `scripting`, and `storage`. Broad host access is optional. The `debugger` and `downloads` capabilities are optional and requested only for operations that need them.

## Run the CLI conveniently

During development use `node packages/cli/bin/conduit.js`. You may also link the workspace package locally:

```bash
pnpm --filter @conduit/cli link --global
conduit --help
```

Global linking is optional and may depend on your pnpm home configuration.

## Upgrade

After npm publication, the installed CLI can check and upgrade itself:

```bash
conduit upgrade --check
conduit upgrade
```

For a source checkout, stop the daemon, pull the desired commit, perform a frozen
install, rebuild, and reload the unpacked extension:

Stop the daemon, pull the desired commit, perform a frozen install, rebuild, and reload the unpacked extension:

```bash
conduit stop
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
```

## Uninstall

```bash
conduit uninstall
npm uninstall --global conduit-browser
```

The first command stops Conduit and removes automatic startup while preserving
settings and trusted-device records. Use `conduit uninstall --purge` only when you
also intend to permanently delete local credentials and Conduit state.
