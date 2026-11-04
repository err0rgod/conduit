# Changelog

All notable changes to Conduit will be documented here. The project follows Keep a Changelog concepts and will adopt Semantic Versioning when releases begin.

## [Unreleased]

### Security

- The daemon rejects requests whose `Host` header is not an expected loopback name (or, in remote mode, a literal IP, the bind address, or `remote.allowedHosts`), including `/health`, to defeat DNS rebinding. WebSocket upgrades with a web `Origin` are refused; extension (`chrome-extension://`, `moz-extension://`) and origin-less clients are accepted.
- Authenticated remote devices are limited to 120 `/api/action` requests per minute each (`429 RATE_LIMITED` with `retryAfterMs`, audited). Local clients are not limited.
- Audit redaction now also covers JWTs, bearer/basic credentials, long random base64 strings, URL credentials, and secret-looking query parameters inside strings.
- Confirmations are now bound to the exact approved request. A confirmation stores a SHA-256 fingerprint of the operation, resolved target tab, evaluated page URL, and full validated payload; `consume` requires an exact match, stays one-time and expiring, and a mismatch is audited as denied without spending the approval. Previously an approval for one navigation could authorize any later same-type action.

### Added

- `remote.allowedHosts` configuration (default empty) for extra DNS names accepted in the `Host` header in remote mode.
- `logging.retentionDays` is now enforced: rotated audit files (`audit.jsonl.<timestamp>`) older than the retention period are deleted at startup and on rotation. Rotation no longer discards the previous rotated file.

### Documentation

- `logging.level`, `browser.screenshotDirectory`, and `browser.downloadBehavior` are documented as reserved, not-yet-implemented configuration fields.

### Fixed

- MCP browser tools accept an optional `confirmationId` and the CLI `browser` commands accept `--confirmation <id>`, so confirmation-gated actions (uploads, debug evaluation, ask-mode navigation) can be completed after the human approves in the extension popup. `USER_CONFIRMATION_REQUIRED` results now tell the agent how to proceed; agents still cannot approve.

## [1.1.4] - 2026-09-10

### Changed

- Installers, `conduit setup`, and `conduit extension install-help` now direct Chrome users to the live Chrome Web Store listing while retaining the verified GitHub unpacked archive for development and recovery.

### Debugging foundation

- Added opt-in `browser.debug` authorization and typed debug operations for bounded console, exception, network metadata, pause/resume, runtime evaluation, and performance tracing.
- Diagnostic events are in-memory, per-tab, sequence-addressable, and redact secret-like fields including bodies, cookies, authorization values, passwords, tokens, and secrets.
- Unrestricted arbitrary Chrome DevTools Protocol access remains unavailable to normal agents; Firefox continues to use its reduced capability package.

## [0.1.3] - 2026-08-25

### Added

- The live Chrome Web Store identity `gjhipjgiapijcdnflldnoenafeegmfpc` is included in the trusted Chromium defaults alongside the deterministic unpacked-development identity.
- Installers, CLI setup guidance, and documentation link directly to the Chrome Web Store listing for Chrome and Brave.

### Changed

- `conduit setup` adds the official Chrome Web Store identity to existing development-only configurations before rewriting Native Messaging manifests.

### Security

- Native Messaging remains an explicit allowlist. The migration adds only Conduit's verified published Chrome identity; arbitrary and future store identities still require `conduit extension trust <id>`.

## [0.1.2] - 2026-08-23

### Added

- Compatible extension `0.1.2` adds strict pre-authentication request rejection, current
  extension-session visibility, optional Chromium capability controls, deterministic icons,
  and checksummed release packaging.
- Authenticated extension management messages for listing and responding to pending confirmations without additional host permissions.
- Extension confirmation review controls showing the risk, operation, domain, summary, and expiry with explicit approve-once or deny decisions.
- Bounded, runtime-validated recent audit-event access over the authenticated extension connection.
- A scrollable extension audit viewer limited to event type, outcome, operation/domain scope, and time.
- The backend accepts the opt-in local-only `security.domainMode: "allow-all"` setting. The default remains `ask`, remote mode rejects this setting, and hard URL/domain/network guards remain non-overridable.
- Documentation now distinguishes the extension's explicit all-sites Chromium host grant from the daemon's independent domain policy.
- PowerShell and Bash installers now install only the checksummed backend, then direct users to the Chrome/Brave, Edge, and Firefox stores before printing portable Agent Skill links.
- Native Messaging registration now covers Chrome, Edge, Brave, Chromium, and Firefox with separate, validated trusted identity lists.
- `conduit extension trust <id>` registers a store-assigned Chromium ID or Firefox add-on ID without accepting arbitrary callers.

### Security

- Confirmation-management messages are runtime validated, correlated, and accepted only from the authenticated extension connection.
- Confirmation decisions are accepted only from Conduit's own popup; summaries are rendered as untrusted text.
- Extension audit access returns only the daemon's structured redacted events and caps each request at 100 records.
- Approved one-time confirmations no longer remain in the pending-review list.

## [0.1.1] - 2026-08-20

### Changed

- The production extension now requests site access explicitly per origin instead of declaring broad host access.
- Browser E2E validates a fresh extension and daemon connection through Native Messaging using the standalone extension repository.
- Browser CI reuses the runner's installed libraries and installs only Playwright Chromium for faster, more reliable validation.

### Security

- Page inspection, interaction, and screenshots are rejected until the user grants the current site from the extension popup.
- Release builds pin the standalone extension to an immutable, fully validated commit.

## [0.1.0] - 2026-08-20

### Added

- pnpm TypeScript monorepo and versioned runtime-validated protocol.
- Authenticated loopback daemon and Manifest V3 Chromium extension.
- Tab, navigation, snapshot, interaction, wait, screenshot, upload, and download operations.
- MCP stdio server, typed daemon client, and cross-platform CLI lifecycle/management commands.
- Permissions, domain policy, confirmations, audit redaction, safe upload paths, and transport limits.
- Revocable P-256 remote-device pairing and TLS-gated non-loopback mode.
- Dedicated unit, integration, security, coverage, and real Chromium E2E suites.
- VitePress documentation site and open-source project policies.
- Standalone extension repository integration with Native Messaging auto-discovery.
- Checksummed GitHub Release artifacts and no-admin user installers.

### Security

- Upload permission and confirmation are evaluated before inspecting host filesystem paths.
- Clean installations grant only `browser.read` and ask before first-use domains.
- Native Messaging is pinned to the deterministic Conduit extension identity.

[Unreleased]: https://github.com/err0rgod/conduit/commits/main
[1.1.4]: https://github.com/err0rgod/conduit/releases/tag/v1.1.4
[0.1.3]: https://github.com/err0rgod/conduit/releases/tag/v0.1.3
[0.1.2]: https://github.com/err0rgod/conduit/releases/tag/v0.1.2
[0.1.1]: https://github.com/err0rgod/conduit/releases/tag/v0.1.1
[0.1.0]: https://github.com/err0rgod/conduit/releases/tag/v0.1.0
