# Architecture

Conduit is a typed request pipeline with security decisions concentrated in the daemon.

```text
MCP client / CLI / trusted remote device
                  │ HTTP + bearer/session credential
                  ▼
             Conduit daemon
      protocol validation → policy → confirmation → audit
                  │ authenticated WebSocket
                  ▼
          Chromium MV3 extension
                  │ chrome.tabs / scripting / optional debugger
                  ▼
             Browser page
```

## Boundaries

- `packages/protocol` is the runtime-validated source of truth for request and response envelopes.
- `packages/security` owns local tokens, domain and permission evaluation, confirmations, upload-path validation, pairing identities, throttling, and audit redaction.
- `apps/daemon` owns transport and session state. It never executes browser DOM actions itself.
- `packages/browser-core` owns browser operations without knowing about HTTP, MCP, or CLI.
- `apps/extension` authenticates once, dispatches validated actions, and returns structured results.
- `packages/daemon-client`, `packages/mcp-server`, and `packages/cli` are client adapters.

## Request lifecycle

Every action carries a UUID request ID, protocol version, and timestamp. The daemon validates the message, authenticates the caller, checks device grants and local policy, consumes any required one-time confirmation, applies upload constraints if relevant, and forwards it to the authenticated extension. Responses use correlated IDs and stable error codes.

The daemon bounds body size, concurrent work, authentication failures, and duplicate request IDs. It closes unauthenticated and expired extension sessions and fails in-flight work during shutdown with a structured error.

## State

Configuration, the local token, trusted-device public identities, and audit files live in the platform application-data directory. Browser passwords are never stored. Remote credentials are revocable public identities rather than reusable pairing codes.

See the repository [ARCHITECTURE.md](https://github.com/err0rgod/conduit/blob/main/ARCHITECTURE.md) for deeper tradeoffs and threat boundaries.
