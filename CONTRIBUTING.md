# Contributing to Conduit

Thank you for helping build a secure local browser bridge.

## Before starting

Search existing issues and pull requests. Open a design issue before large protocol changes, new mandatory browser permissions, remote transports, credential storage, or behavior that increases the agent's authority.

Security reports must follow [SECURITY.md](SECURITY.md), not public issue workflows.

## Development setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Node 20+ and pnpm 9.15.9 are required. Load `apps/extension/dist` as an unpacked extension for manual browser testing.

## Standards

- strict TypeScript and explicit public types;
- Zod validation at trust boundaries;
- small modules and structured errors;
- safe, platform-neutral filesystem/process behavior;
- no `any`, silent catches, unrestricted evaluation, shell exposure, or fake production handlers;
- no real credentials, profiles, audit data, or personal screenshots in tests.

Security decisions belong in daemon/security boundaries, not only in client UI. Page content must never be treated as policy.

## Tests

Choose the smallest meaningful layer and add a regression for fixes:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:security
pnpm test:e2e
pnpm test:coverage
```

Before every commit run:

```bash
pnpm format
pnpm lint
pnpm typecheck
```

Before opening a PR also run `pnpm test`, `pnpm build`, and `pnpm docs:build`. Browser-facing changes should run E2E.

## Pull requests

Keep commits coherent and history reviewable. Explain security impact, user-visible behavior, tests, limitations, and documentation changes. Do not claim support that was not exercised. Maintainers may request threat-model or cross-platform evidence.

By contributing, you agree that your contribution is licensed under the repository's MIT License and to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
