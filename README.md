# Conduit

> Connect any AI agent to your browser securely.

Conduit is an open-source, local-first browser-control bridge for AI agents. It connects MCP or CLI clients to a user's existing Chromium browser through an authenticated local daemon and a Manifest V3 extension.

**Status:** pre-1.0 foundation software. The core vertical slice is implemented and exercised in real Chromium, but Conduit is not yet recommended for unattended use with sensitive accounts.

[Documentation](https://err0rgod.github.io/conduit/) · [Security](SECURITY.md) · [Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

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

## Prerequisites

- Node.js 22+ (Node 24 LTS recommended)
- Corepack and pnpm 9.15.9
- Chrome, Edge, or compatible Chromium browser with Manifest V3

## Install from source

```bash
git clone https://github.com/err0rgod/conduit.git
cd conduit
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Conduit is not yet published to npm or a browser extension store.

### Test the consumer package locally

The release build produces a self-contained npm tarball named `conduit-browser`. It
includes the CLI, daemon, MCP adapter, and unpacked extension without runtime
`workspace:*` dependencies:

```bash
pnpm distribution:pack
npm install --global ./artifacts/conduit-browser-0.1.0.tgz
conduit setup
```

This exercises the same artifact intended for npm publication. The CI matrix also
installs the tarball into a clean prefix and verifies setup, extension discovery,
and the daemon start/status/stop lifecycle.

`conduit setup` creates secure local configuration, registers current-user automatic startup for
the current user without administrator rights, starts the daemon, and prints the
extension path. Use `--no-service` or `--no-start` when managing those pieces
yourself.

## Extension setup

```bash
node packages/cli/bin/conduit.js extension path
node packages/cli/bin/conduit.js extension pair
```

Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, choose
**Load unpacked**, and select the printed directory. Enter port `9222` and the
short-lived code in the Conduit popup. The code expires after five minutes, works
once, and lets the extension store the local credential without displaying it.

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
pnpm docs:build
pnpm test:e2e
```

The E2E suite launches Chromium with the built extension and exercises the authenticated daemon path against a controlled page.

## Known limitations

- source/unpacked-extension distribution only;
- reliable interaction focuses on the main document; cross-origin nested frames remain limited;
- extension confirmation/audit management UI is not complete;
- config fields for retention and screenshot persistence precede their full scheduled behavior;
- remote networking must be supplied and secured by the operator;
- no stable release or compatibility guarantee yet.

See the [roadmap](https://err0rgod.github.io/conduit/roadmap).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
