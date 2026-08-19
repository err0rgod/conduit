# Changelog

All notable changes to Conduit will be documented here. The project follows Keep a Changelog concepts and will adopt Semantic Versioning when releases begin.

## [Unreleased]

### Added

- Authenticated extension management messages for listing and responding to pending confirmations without additional host permissions.

### Security

- Confirmation-management messages are runtime validated, correlated, and accepted only from the authenticated extension connection.
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
[0.1.1]: https://github.com/err0rgod/conduit/releases/tag/v0.1.1
[0.1.0]: https://github.com/err0rgod/conduit/releases/tag/v0.1.0
