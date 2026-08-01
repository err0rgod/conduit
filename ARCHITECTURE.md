# Conduit Architecture

## Goals

Conduit provides a small, inspectable path from an authorized agent request to a user's existing Chromium tab. Local operation, explicit authority, protocol validation, and reversible trust are architectural constraints rather than optional features.

## Components

### Protocol

`packages/protocol` defines versioned Zod schemas and TypeScript types for request/response envelopes, browser targets/actions/results, snapshots, errors, permissions, confirmations, pairing, and remote authentication. Request UUIDs, correlation IDs, timestamps, and protocol versions cross every transport boundary.

### Security

`packages/security` owns local bearer authentication, platform data paths, permission/domain policy, one-time confirmation state, audit redaction/rotation, path allowlists, rate limiting, trusted-device storage, pairing codes, P-256 fingerprints/signatures, challenges, and session authentication.

### Daemon

`apps/daemon` is the policy enforcement point. It exposes local HTTP endpoints to CLI/MCP clients and an authenticated WebSocket for the extension. It validates input before dispatch, enforces both device and host grants, manages confirmation consumption, bounds resource use, coordinates request/response IDs, and records audit events.

It binds to `127.0.0.1` by default. Public/LAN binding is rejected unless remote mode and TLS are both explicitly configured.

### Browser core and extension

`packages/browser-core` implements browser operations through `chrome.tabs`, `chrome.scripting`, and narrowly requested optional APIs. `apps/extension` owns connection state and dispatch. The production manifest keeps host access optional.

Structured snapshots generate short-lived element references. Semantic role/name, label, text, and selector targeting remain fallbacks. Page content is always untrusted data.

### Clients

`packages/daemon-client` validates daemon responses and centralizes authentication. `packages/mcp-server` maps JSON-schema-described MCP tools to the shared protocol. `packages/cli` supplies cross-platform lifecycle, configuration, diagnostics, policy, pairing, and browser commands.

## Data flow

1. A client creates a versioned request envelope.
2. The daemon authenticates the local token or remote session.
3. Zod validates the full operation and payload.
4. Remote device grants and host security policy are evaluated.
5. A required confirmation is created or consumed.
6. Upload paths, if any, are normalized only after authorization and confirmation.
7. The request is placed in a bounded pending map and sent to the authenticated extension.
8. The extension executes the browser operation and returns a correlated response.
9. The daemon updates minimal tab state, writes a redacted audit event, and returns a structured result.

## Lifecycles

The CLI starts the daemon as a detached Node process and stores its PID plus random instance ID. Graceful stop is requested through a locally authenticated endpoint only after checking live identity. Extension sessions authenticate within a deadline, receive heartbeats, expire, and are replaced explicitly on reconnect. Pending requests time out or fail during shutdown.

## Remote identity

Pairing codes are random, short-lived, one-use invitations. Approval records a P-256 public key fingerprint and a permission subset. Authentication signs a purpose/digest-bound fresh challenge. Successful proof creates a short-lived opaque session; revocation removes active sessions. TLS protects non-loopback transport. Conduit does not invent a public relay or automatically change network configuration.

## Storage

Configuration, token, daemon state/logs, audit log, and trusted-device records use the OS application-data directory with restrictive modes where supported. Windows relies on profile ACLs. No raw browser passwords are stored. Cookie APIs are not currently exposed.

## Tradeoffs and current limits

- MV3 service workers can be suspended, so reconnection is expected.
- `chrome.scripting` preserves a smaller base permission set but cannot solve every cross-origin frame or closed-shadow-root case.
- Temporary element references are safer and clearer than arbitrary evaluation, but rerenders invalidate them.
- Local bearer authentication assumes the user's OS account is not compromised.
- In-memory confirmations require the daemon to remain running; a future UI/storage design may evolve them.
