# Browser Extension

The Conduit extension is a Chromium Manifest V3 extension with a background service worker and a small connection popup.

## Permissions

The base manifest requests:

- `tabs` for tab metadata and lifecycle operations;
- `scripting` for page snapshots and standard DOM interactions;
- `storage` for the local port/token configuration.

Host access is optional (`<all_urls>`). Advanced pointer, keyboard, and file operations may request the optional `debugger` permission. Download observation may request `downloads`. Conduit does not silently place broad host access in the mandatory permission list.

## Authentication

The extension opens a WebSocket to the configured loopback daemon and must authenticate with the local token before sending or receiving actions. The daemon replaces an older extension connection when a new authenticated connection takes ownership.

Use `conduit extension token` only in a private terminal. The token is equivalent to local control authority while the daemon is running.

## Rebuild and reload

```bash
pnpm extension:build
pnpm extension:package
```

After rebuilding, click **Reload** on the extension card in `chrome://extensions`.

## Current limitations

The reliable path targets the main document. Snapshot frame metadata is reported, but cross-origin nested-frame interaction is not a general guarantee. Closed shadow roots are inaccessible. Browser dialogs, popup ownership, and complex multi-frame workflows need additional E2E coverage. The extension currently uses unpacked developer installation; no signed store package is published.
