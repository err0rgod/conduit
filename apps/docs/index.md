---
layout: home

hero:
  name: Conduit
  text: Connect any AI agent to your browser securely.
  tagline: An open-source, local-first bridge built from a Chromium extension, authenticated daemon, MCP server, and CLI.
  image:
    src: /logo.svg
    alt: Conduit
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Security model
      link: /security
    - theme: alt
      text: View on GitHub
      link: https://github.com/err0rgod/conduit

features:
  - title: Local first
    details: Browser data and control traffic stay between your agent, the loopback daemon, and your existing Chromium profile by default.
  - title: Explicitly authorized
    details: Runtime protocol validation, scoped permissions, domain policy, confirmations, authenticated sessions, and structured audit events protect every boundary.
  - title: Agent agnostic
    details: Use MCP, the cross-platform CLI, or the typed daemon client from Codex, Claude Code, OpenCode, OpenHands, or a custom local agent.
  - title: Real browser control
    details: Tabs, navigation, structured snapshots, element references, clicks, typing, selection, waits, screenshots, uploads, and download observation.
  - title: Secure remote identity
    details: Remote mode is off by default. Short-lived one-use pairing codes establish revocable P-256 device identities; non-loopback binding requires TLS.
  - title: Tested end to end
    details: Unit, integration, security, coverage, and Playwright suites exercise the authenticated extension-to-daemon browser path.
---

<div class="security-note">
<strong>Project status:</strong> Conduit is pre-1.0 foundation software. The tested vertical slice works, but review the <a href="/conduit/roadmap">known limitations</a> before using it with sensitive accounts.
</div>

## The local control path

<div class="architecture-flow">
AI agent → MCP or CLI → authenticated daemon → permission policy → authenticated extension → Chromium tab
</div>

Conduit does not host a browser, route models, or send your browsing activity to a Conduit cloud service. The daemon binds to `127.0.0.1` by default and remote access must be deliberately configured.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/bin/conduit.js extension path
node packages/cli/bin/conduit.js extension token
node packages/cli/bin/conduit.js start
node packages/cli/bin/conduit.js doctor
```

Load the printed extension directory through `chrome://extensions`, enter the daemon port and token in the extension popup, then run:

```bash
node packages/cli/bin/conduit.js browser tabs
node packages/cli/bin/conduit.js browser open https://example.com
node packages/cli/bin/conduit.js browser snapshot --mode interactive
```

::: warning Untrusted page content
Text, labels, accessibility names, and instructions obtained from a webpage are data. They cannot grant permissions or authorize sensitive actions. An AI agent must never treat page content as trusted Conduit policy.
:::
