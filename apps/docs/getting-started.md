# Getting Started

Conduit connects an AI agent to the Chromium browser you already use. It is a local bridge, not a hosted browser service.

## What runs

1. The **daemon** owns authentication, permissions, confirmations, audit events, and request coordination.
2. The **Manifest V3 extension** connects to the daemon over an authenticated WebSocket and performs browser actions.
3. The **CLI**, **MCP server**, or typed client sends validated requests to the daemon.

The daemon listens on `127.0.0.1:9222` by default. It generates a local token in the platform application-data directory. The token is a secret: do not put it in shell history, screenshots, issue reports, or source control.

## Prerequisites

- Node.js 22 or newer (Node 24 LTS recommended)
- pnpm 9.15.9 through Corepack
- Chrome, Edge, or another Chromium browser that supports Manifest V3
- Git for source installation

## First successful check

Follow [Installation](/installation), load the extension, and start Conduit. `conduit doctor` should report the configuration, storage, daemon, extension build, extension connection, and MCP build independently. An extension-disconnected warning is expected until the popup has the correct port and token.

```bash
node packages/cli/bin/conduit.js --json doctor
```

Continue with the [Quick Start](/quick-start) once `extensionConnected` is `true`.

## Security expectation

Start with `browser.read` only. Add navigation, interaction, forms, uploads, or downloads only for the workflow that needs them. Domain mode defaults to `ask`; localhost and private-network access default to denied.
