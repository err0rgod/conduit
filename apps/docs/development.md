# Development

Conduit is a pnpm TypeScript monorepo.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## Workspace map

```text
apps/daemon       local HTTP/WebSocket service
apps/extension    Chromium MV3 extension
apps/docs         VitePress documentation
packages/protocol shared schemas and types
packages/security policy, auth, pairing, audit
packages/browser-core browser implementation
packages/daemon-client typed client
packages/mcp-server MCP adapter and stdio entry
packages/cli      command-line interface
```

Use strict TypeScript, runtime validation at trust boundaries, small modules, structured errors, and platform-neutral process/file handling. Do not commit generated profiles, tokens, screenshots, logs, or certificates.

## Useful development commands

```bash
pnpm daemon:dev
pnpm extension:dev
pnpm docs:dev
pnpm mcp:start
pnpm conduit:doctor
```

Read [CONTRIBUTING.md](https://github.com/err0rgod/conduit/blob/main/CONTRIBUTING.md) before opening a pull request.
