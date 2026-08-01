# Testing

Conduit separates fast logic checks from process, security, and browser validation.

```bash
pnpm test:unit
pnpm test:integration
pnpm test:security
pnpm test:e2e
pnpm test:coverage
```

`pnpm test` runs unit, integration, and security suites. Coverage enforces minimum global thresholds. The E2E suite builds the extension, starts a real daemon, launches Chromium with an isolated profile, authenticates the extension, controls a fixture page, and captures a screenshot.

## Required pre-commit checks

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
```

Browser tests require a Chromium installation and a desktop-capable environment because extension loading is exercised in headed persistent-context mode.

Tests must assert behavior and security boundaries, not only mock calls. Any unsupported browser scenario should return a precise failure rather than a simulated success.
