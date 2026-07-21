# Conduit Architecture Plan

## 1. Component Structure
The project will be structured as a pnpm monorepo.
- `apps/extension`: The Manifest V3 Chromium extension.
- `apps/daemon`: The local Node.js daemon.
- `apps/docs`: The documentation website (using VitePress).
- `packages/protocol`: Shared zod schemas and types for communication.
- `packages/browser-core`: Transport-independent browser abstraction.
- `packages/mcp-server`: Model Context Protocol server.
- `packages/cli`: `conduit` command-line interface.
- `packages/security`: Permission, authentication, and encryption logic.
- `packages/test-utils`: Helpers for integration and E2E testing.

## 2. Browser-Control Method
The extension will communicate with the browser tabs using a combination of `chrome.tabs`, `chrome.scripting`, and potentially `chrome.debugger` (for advanced features). The background service worker will act as the orchestrator, connecting securely via WebSockets to the local daemon.

## 3. Protocol
All messages between daemon and extension (or daemon and clients) will be strictly typed and runtime-validated using `zod`. We will define versioned schemas for:
- Request/Response envelopes
- Tab/Browser actions
- Authentication & Pairing
- Error codes

## 4. Authentication
- Local: The daemon generates a secure token (stored in AppData/os-specific secure location). The extension/CLI authenticate using this token.
- Remote: Secure pairing via short-lived pairing codes. Uses public-key cryptography (e.g., Libsodium/TweetNaCl or WebCrypto) for device identity.

## 5. Permissions
A strict, deny-by-default permission model.
- Capabilities are scoped (e.g., `browser.read`, `browser.click`, `browser.forms`).
- Domain policies (allowlist/blocklist).
- High-risk operations require explicit user confirmation via the daemon.

## 6. Storage
Data (tokens, logs, permission grants, trusted device keys) will be stored in secure local AppData paths (using libraries like `conf` or raw `fs` with restrictive permissions).
- Never store raw passwords or sensitive cookies.

## 7. Testing
- Unit: `vitest` for business logic, schemas, and security packages.
- Integration: Testing daemon startup, extension WebSocket flow, and MCP integration.
- E2E: `playwright` with a loaded extension to perform real DOM operations on fixture pages.

## 8. Remote Pairing
Disabled by default. When explicitly enabled (`conduit pair`), it uses a pairing code workflow to exchange public keys. Future sessions authenticate via device credentials. LAN/Internet connectivity relies on secure abstractions (recommending Tailscale/WireGuard rather than custom relays).

## 9. Documentation Deployment
`apps/docs` will use VitePress. A GitHub Actions workflow will build the docs and deploy them to GitHub Pages (`err0rgod.github.io/conduit/`).
