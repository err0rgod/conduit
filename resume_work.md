# Conduit Work Resume

Last updated: 2026-08-04

## Read this first

The user's current requirements override the older monorepo decision recorded in
`AGENTS.md`:

1. Keep the backend, daemon, CLI, MCP server, installers, and documentation in
   `D:\conduit` / `https://github.com/err0rgod/conduit`.
2. Keep the Chromium extension and its browser execution code in
   `D:\conduit-extension` / `https://github.com/err0rgod/conduit-extension`.
3. Remove pairing codes from the local extension setup flow.
4. Make backend setup essentially one command.
5. The extension is installed once, then connects automatically whenever the
   local Conduit daemon is available.
6. Preserve secure defaults: loopback-only daemon, exact extension identity,
   no unauthenticated HTTP token-bootstrap endpoint.

Read `AGENTS.md` and `whatiwant.txt`, then update the stale handoff section in
`AGENTS.md` to reflect this two-repository decision.

## Current repositories

### Backend

- Local path: `D:\conduit`
- GitHub: `https://github.com/err0rgod/conduit`
- Public repository and GitHub Pages are already enabled.
- Documentation: `https://err0rgod.github.io/conduit/`
- Expected branch on disk: `main`, tracking `origin/main`.
- Last known main commit: `52fc3b1` after PR #23.
- The working tree has private, untracked notes which must not be staged,
  modified, deleted, or published:
  - `deployment.txt`
  - `resume.txt`
  - `whatiwant.txt`
  - `resume_work.md`

### Extension

- Local path: `D:\conduit-extension`
- GitHub: `https://github.com/err0rgod/conduit-extension`
- Public repository.
- `main` contains the validated standalone foundation and merged PR #1.
- Open coordinated feature PR:
  `https://github.com/err0rgod/conduit-extension/pull/2`
- Feature branch: `feat/native-auto-connect`
- Feature commit: `3a7da03`

## Work already completed

### Earlier backend milestones

- PR #19: standalone `conduit-browser` distribution.
- PR #20: setup, update, uninstall, and user-level startup support.
- PR #21: short-lived extension pairing (now being superseded only for the
  local extension flow; remote-device pairing remains required).
- PR #22: fixed Windows setup access denial by replacing Scheduled Tasks with
  the current-user HKCU Run key.
- PR #23: prior session handoff update.
- `conduit-browser@0.1.0` was built and installed globally from a local tarball.
- `conduit setup` was validated on this Windows machine.
- The daemon was last known healthy on `127.0.0.1:9222` with Windows automatic
  startup registered.

### New extension repository foundation

- Created `D:\conduit-extension` with:
  - `apps/extension`
  - `packages/browser-core`
  - `packages/protocol`
  - independent package configuration, lockfile, tests, build, CI, README,
    SECURITY, and AGENTS files.
- Created public GitHub repository `err0rgod/conduit-extension`.
- Foundation commit `f3a84e7` was pushed.
- Initial CI exposed Windows checkout line-ending differences.
- PR #1 added `.gitattributes`; Windows, macOS, and Linux CI all passed; PR #1
  was squash-merged as `a461f86`.

### Extension native auto-connect PR #2

PR #2 is pushed but intentionally not merged until the backend half works.

It implements:

- deterministic unpacked extension identity using a public manifest key;
- stable extension ID `jkdlmcpkgkooilffjegfjmkanoelbmbl`;
- the `nativeMessaging` permission;
- native host name `io.github.err0rgod.conduit`;
- versioned native connection-settings validation;
- automatic discovery of daemon port and token;
- persisted extension-local settings;
- automatic WebSocket connection and reconnect;
- token refresh after authentication failure;
- pairing-code UI removal;
- a dark connection-status popup with retry control;
- tests for invalid protocol versions, ports, tokens, manifest identity, and
  native messaging permission.

Validation already passed locally in the extension repository:

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` — 14 tests passed
- `pnpm build`

## Important security decision

Do not add an unauthenticated endpoint such as `/api/extension/bootstrap` that
returns the daemon bearer token based only on an HTTP `Origin` header. A local
process can forge that header.

Use Chromium Native Messaging instead. Official Chrome documentation confirms:

- the extension declares `nativeMessaging`;
- the native host manifest uses exact `allowed_origins` without wildcards;
- Chrome starts the native host and communicates with length-prefixed JSON over
  stdin/stdout;
- Windows supports per-user HKCU registration;
- macOS and Linux support per-user native-host manifest directories.

Official reference:
`https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging`

The expected allowed origin is:

`chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl/`

Native protocol version: `1`.

Expected extension request:

```json
{
  "type": "conduit.get-connection-settings",
  "protocolVersion": 1
}
```

Expected native-host response:

```json
{
  "type": "conduit.connection-settings",
  "protocolVersion": 1,
  "daemonPort": 9222,
  "daemonToken": "<64 lowercase hexadecimal characters>"
}
```

Never log or print the daemon token outside the native messaging frame.

## Exact next milestone: backend native host

Create a backend feature branch, suggested name:

`feat/native-extension-bootstrap`

Implement a focused module, probably under `packages/cli/src/native-host.ts`,
with two clear responsibilities.

### 1. Native messaging protocol handler

- Read one Chromium native message from stdin.
- The frame is a 32-bit native-order message length followed by UTF-8 JSON.
  Supported target machines are little-endian, so use explicit LE framing and
  document/test it.
- Enforce a small input limit (for example 64 KiB), even though Chromium allows
  more.
- Validate exact caller origin from the argument Chrome passes to the host.
- Validate request type and protocol version.
- Load the configured daemon port from `ConfigStore`.
- Obtain the local token using `LocalAuth.ensureToken()`.
- Write exactly one framed JSON response to stdout and no ordinary CLI text.
- Send diagnostics only to stderr and never include the token.
- Add meaningful tests for framing, truncation, oversized payloads, malformed
  JSON, wrong origin, wrong request type/version, and a valid response.

Integrate it before normal Commander parsing in `runCli()`, because Chromium
appends the caller origin and on Windows a `--parent-window` argument. Suggested
internal invocation:

`conduit extension native-host <origin> [--parent-window=0]`

Do not expose this as a normal user-facing command or let Commander reject the
browser-supplied arguments.

### 2. Per-user native host registration

Implement a testable `NativeHostInstaller` or equivalent.

The generated host manifest should contain:

```json
{
  "name": "io.github.err0rgod.conduit",
  "description": "Conduit local browser bridge",
  "path": "<absolute wrapper path>",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://jkdlmcpkgkooilffjegfjmkanoelbmbl/"]
}
```

The wrapper must invoke the current Node executable and the actual installed
CLI entry path while forwarding Chromium arguments.

- Windows: create a quiet `.cmd` wrapper (`@echo off`) and register the manifest
  under current-user keys for Google Chrome and Microsoft Edge. Also consider
  Chromium. Verify with a real browser because native-host process launching of
  command wrappers is the highest-risk platform detail.
- macOS: create an executable shell wrapper and place manifests in the
  user-specific Google Chrome, Microsoft Edge, and Chromium
  `NativeMessagingHosts` directories.
- Linux: create an executable shell wrapper and place manifests in the
  user-specific Google Chrome, Microsoft Edge, and Chromium
  `NativeMessagingHosts` directories.
- Use restrictive file modes where supported.
- Registration and removal must be idempotent.
- No administrator access should be required.
- Unit-test paths, manifests, escaping, registry commands, install, status, and
  uninstall behavior for all three platforms.

### 3. Connect registration to setup/uninstall/doctor

Change `packages/cli/src/setup.ts`:

- `conduit setup` registers the native host.
- Remove local extension pairing-code creation from setup.
- Setup report contains native-host registration status, not a pairing code.
- Next steps should say to install/load the extension once; it then connects
  automatically.
- `conduit uninstall` removes native-host registration.
- Purging remains explicit and safe.

Change CLI commands:

- Remove or deprecate `conduit extension pair`; it is obsolete for local
  extension setup.
- Keep remote-device `conduit pair` behavior unchanged.
- Update `conduit extension install-help` for the separate extension repository
  and automatic connection.
- Eventually `conduit extension path` should no longer imply that the extension
  is bundled in the backend package.

Extend `conduit doctor` to report native-host registration and the expected
extension identity.

Update and expand tests in:

- `packages/cli/test/setup.test.ts`
- `packages/cli/test/index.test.ts`
- new native-host unit tests
- relevant distribution clean-install tests

## Repository cutover still required

After native messaging works end to end:

1. Stop bundling `apps/extension` into the backend npm distribution.
2. Remove `apps/extension` and `packages/browser-core` from the backend only
   after cross-repository validation proves the new extension works.
3. Keep the protocol contract synchronized. Before independent package releases,
   add a compatibility fixture or shared protocol artifact checked by both repos.
4. Update E2E tests to build/use `D:\conduit-extension` or a pinned downloaded
   extension artifact rather than the backend copy.
5. Update backend README/docs/architecture/security/install pages to link to
   `err0rgod/conduit-extension`.
6. Update repository metadata/topics if needed.

Do not delete working backend extension code before the new vertical slice is
validated.

## Required validation before merging coordinated PRs

1. Run backend formatting, lint, typecheck, unit, integration, security tests,
   build, docs build, and distribution tests.
2. Build the extension from PR #2.
3. Install or rebuild the backend distribution locally.
4. Run `conduit setup` as the current Windows user and confirm no access-denied
   error.
5. Verify native host manifest files and HKCU keys exactly.
6. Load `D:\conduit-extension\apps\extension\dist` into Chromium.
7. Confirm its ID is `jkdlmcpkgkooilffjegfjmkanoelbmbl`.
8. Confirm the extension obtains connection settings without a pairing code.
9. Confirm `conduit status` reports `extensionConnected: true`.
10. Exercise the real vertical slice: list tabs, open/navigate, snapshot, click,
    type, screenshot, CLI result, and MCP result.
11. Test restart/reconnect and token refresh.
12. Test uninstall removes native-host registration.
13. Push backend branch and open a PR.
14. Wait for all GitHub checks in both repositories.
15. Merge coordinated backend and extension PRs only after all validation passes.
16. Update both `AGENTS.md` handoff sections after merge.

## Later milestones after auto-connect

1. Add checksum-verified curl and PowerShell installers backed by real GitHub
   Release artifacts. Do not advertise nonexistent release URLs.
2. Expand clean-machine install/update/uninstall validation.
3. Recreate the extension and docs UI using the reference site's design language
   without copying its branding or proprietary content.
4. Package/publish the extension and backend independently.
5. Publish backend to npm only when release credentials and explicit publication
   authorization are available.
6. Validate GitHub Pages, release artifacts, install commands, and end-user docs.

## Honest end-user constraint

The backend can be installed with one command, eventually via npm, curl, or
PowerShell. A normal public command cannot silently install an unpacked Chrome or
Edge extension because browsers intentionally require store/policy/user approval.
The intended experience is therefore:

1. Install the backend with one command.
2. Run `conduit setup` once.
3. Install/load the extension once with explicit browser approval.
4. Automatic secure connection thereafter, with no pairing code.

## Git discipline

- Never force-push or rewrite public history.
- Work on feature branches.
- Before commits run `pnpm format`, `pnpm lint`, `pnpm typecheck`, relevant tests,
  and builds.
- Push each stable milestone, open a PR, wait for CI, then merge.
- Do not merge extension PR #2 until the backend half is compatible and the real
  browser flow passes.
- Preserve all private untracked notes.
