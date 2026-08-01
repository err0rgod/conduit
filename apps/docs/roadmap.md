# Roadmap

Conduit is pre-1.0. The authenticated local vertical slice is working and tested: daemon lifecycle, extension authentication, tabs/navigation, snapshots, interaction, screenshot, MCP, CLI, permission policy, audit logging, upload constraints, and remote device identity.

## Next reliability work

- broader fixture coverage for SPA navigation, iframes, shadow DOM, popups, upload, and downloads;
- first-class user confirmation UI in the extension;
- richer audit viewer, retention enforcement, and session management UI;
- platform secure-store adapters for local and remote private credentials;
- graceful cancellation and more precise browser-dialog support;
- stronger semantic element recovery across rerenders.

## Distribution

- signed extension packages and documented Chrome/Edge store review;
- versioned CLI/package release pipeline and provenance;
- compatibility matrix for supported Node and Chromium versions.

## Intentionally not planned

Conduit will not become a hosted browser farm, model router, billing platform, analytics product, or insecure public relay. Internet access should use a trusted private network or separately reviewed encrypted transport.

Roadmap items are not claims of current support. Track implementation status in GitHub issues and releases.
