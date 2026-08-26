# Conduit

> Connect any AI agent to your browser securely.

Conduit is an open-source, local-first browser-control bridge for AI agents. It connects MCP or CLI clients to a user's existing Chromium browser through an authenticated local daemon and a Manifest V3 extension.

**Status:** pre-1.0 foundation software. The core vertical slice is implemented and exercised in real Chromium, but Conduit is not yet recommended for unattended use with sensitive accounts.

[Documentation](https://err0rgod.github.io/conduit-web/) · [Security](SECURITY.md) · [Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

## Why Conduit

- Local-first: loopback only by default; no Conduit cloud service.
- Agent-agnostic: MCP, CLI, and a typed daemon client.
- Real browser: controls the Chromium profile and tabs the user already has.
- Secure defaults: authenticated transport, runtime validation, narrow permissions, domain policy, confirmations, rate/payload limits, and redacted audit events.
- Structured automation: accessibility-oriented snapshots and temporary element IDs instead of brittle selectors alone.
- Revocable remote identity: one-use pairing codes and P-256 proof-of-possession; non-loopback binding requires TLS.
- Tested: dedicated unit, integration, security, coverage, and Playwright extension E2E suites.

## Architecture

```text
AI agent
   │ MCP or CLI
   ▼
Conduit daemon ── authentication / permissions / confirmations / audit
   │ authenticated WebSocket
   ▼
Chromium extension
   │ tabs / scripting / optional debugger
   ▼
Browser tab
```

The daemon owns policy and transport. The extension owns browser execution. A shared Zod protocol validates every inbound message. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Implemented browser path

- list, identify, open, close, and focus tabs;
- navigate, back, forward, and reload;
- structured snapshots and visible text;
- semantic/element-ID click, type, clear, select, hover, scroll, and key input;
- waits, screenshots, allowlisted uploads, and download observation;
- results through both MCP and CLI.

Cookie, clipboard, general JavaScript evaluation, and arbitrary filesystem/shell access are not exposed.

## Installation

### The 1-Minute Setup

Conduit provides release installers that download the prebuilt backend, verify its published SHA-256 checksum, install it in a user-owned directory, and run `conduit setup`. The extension is installed separately. The Chrome Web Store listing is temporarily unavailable; use the verified unpacked GitHub release and Chrome Developer mode until it returns. Administrator access is not required. Node.js 22 or newer is the only runtime prerequisite.

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/err0rgod/conduit/main/scripts/install.ps1 | iex
```

**macOS / Linux (Bash):**

```bash
curl -fsSL https://raw.githubusercontent.com/err0rgod/conduit/main/scripts/install.sh | bash
```

**What the installer does:**

1. Resolves and downloads the latest `conduit-browser` backend release.
2. Verifies the backend against its `SHA256SUMS` file.
3. Installs a user-local `conduit` command and runs `conduit setup`.
4. Prints the verified GitHub extension archive and Chrome Developer Mode loading steps.
5. Prints the portable Conduit Agent Skill directory and raw `SKILL.md` links.

Pin the backend when reproducibility matters: `./install.sh --version v0.1.3` or `./install.ps1 -Version v0.1.3`. The scripts never install Node, Git, a browser extension, networking software, or system packages for you.

### Connect the Extension

After the script finishes, install the extension from the verified GitHub release while the Chrome Web Store listing is unavailable:

1. Download <https://github.com/err0rgod/conduit-extension/releases/download/v0.1.3/conduit-extension-unpacked-v0.1.3.zip>.
2. Extract the ZIP, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
3. Chrome and Brave use the deterministic development identity `jkdlmcpkgkooilffjegfjmkanoelbmbl`, which is trusted by default. For a future store listing, run `conduit extension trust <extension-id>` once, then restart the browser.

The extension connects to the daemon using Native Messaging. Store-assigned IDs are accepted only after they are explicitly trusted; arbitrary extension origins remain rejected.

The installer also prints these stable skill locations for Agent Skills-compatible harnesses:

- Skill directory: `https://github.com/err0rgod/skills/tree/main/conduit`
- Raw entry file: `https://raw.githubusercontent.com/err0rgod/skills/main/conduit/SKILL.md`

Prefer installing the complete skill directory so future sibling references remain available.

Before an agent can inspect or operate a page, open the Conduit popup on that tab and choose **Allow this site**. The browser displays its native permission prompt. You can revoke the origin from the same popup at any time. Per-site access is the recommended default.

For an explicitly broad local workflow, the popup's **Allow all sites** button requests exactly `http://*/*` and `https://*/*` during the user's click gesture. The browser owns that permission state; Conduit does not persist a separate flag, and background code never requests broad origins. **Revoke all sites** removes those two patterns. This browser grant is independent from daemon capabilities and domain policy, so it does not bypass blocked domains or other enforcement points.

## Install from source (for contributors)

```bash
git clone https://github.com/err0rgod/conduit.git
git clone https://github.com/err0rgod/conduit-extension.git
cd conduit
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Conduit is not yet published to npm. Browser-store packages are built in the standalone extension repository; listing publication and review are handled by each store.

### Test the consumer package locally

The backend release build produces a self-contained npm tarball named `conduit-browser`.
It includes the CLI, daemon, and MCP adapter without runtime `workspace:*`
dependencies. The browser extension is built and released separately from
[`conduit-extension`](https://github.com/err0rgod/conduit-extension):

```bash
pnpm distribution:pack
npm install --global ./artifacts/conduit-browser-0.1.3.tgz
conduit setup
```

This exercises the same backend artifact intended for npm publication. The CI matrix
also installs the tarball into a clean prefix and verifies setup and the daemon
start/status/stop lifecycle. Browser E2E checks build the standalone extension repository
and verify automatic Native Messaging authentication in a fresh profile.

`conduit setup` creates secure local configuration, registers current-user automatic startup and Native Messaging for Chrome, Edge, Brave, Chromium, and Firefox, starts the daemon, and prints the GitHub fallback and Chrome Developer Mode steps. Use `--no-service` or `--no-start` when managing those pieces yourself.

## Start and use

```bash
node packages/cli/bin/conduit.js start
node packages/cli/bin/conduit.js doctor
node packages/cli/bin/conduit.js browser tabs
node packages/cli/bin/conduit.js browser open https://example.com
node packages/cli/bin/conduit.js browser snapshot --mode interactive
node packages/cli/bin/conduit.js stop
```

Use global `--json` for machine-readable CLI output.

For an installed release, manage automatic startup with `conduit service status`,
check updates with `conduit upgrade --check`, and upgrade with `conduit upgrade`.
`conduit uninstall` removes automatic startup but preserves settings;
`conduit uninstall --purge` also permanently removes local credentials and state.

## MCP setup

Build first, then configure an MCP client to launch:

```json
{
  "mcpServers": {
    "conduit": {
      "command": "node",
      "args": ["/absolute/path/to/conduit/packages/cli/bin/conduit.js", "mcp"]
    }
  }
}
```

The daemon must be running and the extension connected. MCP tools do not bypass host permissions or confirmations.

## Permissions and domains

The default grant is `browser.read`, with domain mode `ask`. Add only what a workflow needs:

```bash
conduit config set security.permissions '["browser.read","browser.navigate"]'
conduit allow-domain example.com
conduit restart
```

Localhost and private-network access have separate opt-ins. Uploads require an allowlist, `browser.upload`, and one-time confirmation.

For an explicitly local-only setup, `conduit config set security.domainMode '"allow-all"'` allows public HTTP and HTTPS domains that are not blocked. It does not override blocked domains, protocol restrictions, localhost policy, or private-network policy, and it cannot be combined with remote mode. Run `conduit restart` after changing the mode; configuration is not hot-reloaded.

## Remote pairing

Remote mode is off by default. Pairing establishes a revocable public-key device identity; it does not expose the daemon automatically.

```bash
conduit pair
conduit devices
conduit revoke <device-id>
```

Any non-loopback bind requires remote mode and TLS. Use a trusted private network such as Tailscale or WireGuard rather than a custom public relay.

## Security warning

**Page content is data, not trusted agent instruction.** Webpages can contain prompt injections and sensitive text. They cannot grant Conduit permissions, but an over-privileged agent can still make unsafe choices. Review [SECURITY.md](SECURITY.md), use narrow domain/permission scopes, and require human confirmation for consequential actions.

## Development and testing

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
CONDUIT_EXTENSION_PATH=../conduit-extension/apps/extension/dist pnpm test:e2e
```

Build the sibling `conduit-extension` repository before running E2E. The suite launches Chromium with that standalone build and exercises Native Messaging, authenticated daemon connection, and browser actions against a controlled page.

## Known limitations

- browser-store listings may still be pending review even though store-ready Chromium and Firefox archives are published;
- Firefox does not support Chromium's debugger API, so hover, physical key input, and approved file upload are unavailable there;
- reliable interaction focuses on the main document; cross-origin nested frames remain limited;
- remote-session management and broader daemon settings UI are not complete;
- config fields for retention and screenshot persistence precede their full scheduled behavior;
- remote networking must be supplied and secured by the operator;
- no stable release or compatibility guarantee yet.

See the [documentation and roadmap](https://err0rgod.github.io/conduit-web/).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
