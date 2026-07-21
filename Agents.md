You are the lead engineer responsible for independently designing, implementing, testing, documenting, publishing, and validating a production-quality open-source project named **Conduit**.

Conduit is an open-source, local-first browser-control bridge that allows AI agents to securely interact with a user’s real Chromium-based browser.

You have access to the required development environment.

Assume the following are already installed and authenticated:

- Git
- GitHub CLI (`gh`)
- Node.js
- pnpm or npm
- Chromium-based browser
- required build tools

GitHub authentication is already configured.

You must work autonomously from architecture through implementation, testing, GitHub repository creation, continuous commits, pushes, documentation website deployment, and final validation.

The repositry is already initialised you have to git push after every feature implementation.

Do not stop after creating scaffolding.

Do not ask questions or just ask at the starting if needed solve everything through repository inspection, official documentation, experimentation, or sensible engineering judgment.

When a reasonable assumption can be made, make it, document it, and continue.

# Project identity

Project name:

```text
Conduit
```

Primary CLI command:

```bash
conduit
```

Suggested repository name:

```text
conduit
```

Suggested package scope, if needed:

```text
@conduit/*
```

Do not reference Kimi branding in package names, source code, documentation, or marketing.

Position Conduit as:

> An open-source, local-first browser-control bridge for AI agents.

Suggested tagline:

> Connect any AI agent to your browser securely.

# Main objective

Build a clean, understandable, secure, testable foundation that the maintainer can study, maintain, and expand.

The system should allow authorized AI agents such as:

- Claude Code
- OpenCode
- Codex
- Hermes
- OpenHands
- MCP-compatible clients
- CLI-capable agents
- custom local agents

to interact securely with the user’s existing Chromium browser.

The system must remain:

- model-agnostic;
- agent-agnostic;
- local-first;
- secure by default;
- extensible;
- cross-platform;
- well-tested;
- thoroughly documented.

# Core browser capabilities

Authorized agents should be able to:

- list browser tabs;
- identify the active tab;
- open tabs;
- close tabs;
- focus tabs;
- navigate URLs;
- go backward;
- go forward;
- reload pages;
- inspect a page;
- read visible text;
- obtain structured page snapshots;
- identify interactive elements;
- click elements;
- type into inputs;
- clear fields;
- select options;
- hover over elements;
- scroll;
- press keyboard keys;
- wait for page conditions;
- capture screenshots;
- upload files after explicit authorization;
- observe downloads;
- manage browser sessions;
- connect from another trusted device through secure pairing.

# Core engineering principles

Prioritize:

1. Local-first operation
2. Explicit authorization
3. Safe defaults
4. Minimal permissions
5. Strong typing
6. Clear architecture
7. Reliable error handling
8. Meaningful automated tests
9. Cross-platform behavior
10. Understandable code
11. Extensible boundaries
12. Secure remote pairing
13. Honest documentation
14. Incremental Git history
15. Reproducible builds

Do not create fake implementations.

Do not use placeholder production handlers.

Do not create tests that pass without testing meaningful behavior.

Do not claim a feature works unless it has actually been exercised.

# Scope discipline

Build this complete vertical slice before expanding:

```text
AI agent
    ↓
MCP or CLI tool call
    ↓
Conduit daemon
    ↓
authenticated extension connection
    ↓
browser tab
    ↓
page action
    ↓
structured result returned
```

The working path must include at least:

1. Start daemon
2. Connect extension securely
3. List tabs
4. Open or select a tab
5. Navigate
6. Retrieve structured page snapshot
7. Click an element
8. Type into an element
9. Capture a screenshot
10. Return the action result through MCP
11. Return the action result through CLI

Complete and validate this path before adding secondary features.

Do not build unrelated systems such as:

- billing;
- subscriptions;
- model routing;
- hosted browser farms;
- cloud dashboards;
- workflow marketplaces;
- social features;
- mobile applications;
- AI chat interfaces;
- user analytics;
- SaaS account systems.

# Recommended technology

Prefer TypeScript throughout the project.

Recommended stack:

- Node.js LTS
- TypeScript with strict mode
- pnpm workspaces
- Chrome Extension Manifest V3
- WebSocket communication
- Zod or equivalent runtime validation
- official MCP TypeScript SDK
- Vitest
- Playwright
- ESLint
- Prettier
- GitHub Actions
- VitePress, Astro Starlight, or another lightweight maintained documentation framework
- GitHub Pages for documentation hosting

You may choose equivalent tools where technically justified.

Before adding dependencies:

- verify that they are actively maintained;
- avoid unnecessary packages;
- prefer focused libraries;
- lock versions;
- check licensing;
- avoid libraries with questionable security history;
- document important choices.

# Repository and monorepo structure

Use a clean monorepo.

Suggested structure:

```text
conduit/
├── apps/
│   ├── extension/
│   ├── daemon/
│   └── docs/
├── packages/
│   ├── protocol/
│   ├── browser-core/
│   ├── mcp-server/
│   ├── cli/
│   ├── security/
│   └── test-utils/
├── examples/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── fixtures/
├── scripts/
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── README.md
├── ARCHITECTURE.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── LICENSE
├── CHANGELOG.md
├── pnpm-workspace.yaml
└── package.json
```

You may adjust the structure where justified, but maintain clear ownership boundaries.

# GitHub repository setup

Use the authenticated GitHub CLI.

If the current directory is not already associated with the correct repository:

1. Initialize Git.
2. Create the GitHub repository.
3. Use the name `conduit` if available.
4. If that exact name is unavailable in the authenticated account, use a sensible alternative such as:

   - `conduit-browser`
   - `conduit-agent-bridge`
   - `conduit-ai-browser`

5. Prefer a public repository unless existing context clearly requires private.
6. Add a concise repository description.
7. Add suitable topics.
8. Set the default branch to `main`.
9. Configure `origin`.
10. Push the initial commit.

Example repository description:

> Local-first browser control bridge for AI agents using MCP, a secure daemon, and a Chromium extension.

Suggested GitHub topics:

```text
ai-agents
browser-automation
mcp
model-context-protocol
chrome-extension
typescript
local-first
automation
developer-tools
```

Use `gh repo create` and other GitHub CLI commands as needed.

Do not overwrite or delete an unrelated existing repository.

Before creating a remote, inspect:

```bash
git status
git remote -v
gh auth status
```

# Incremental Git workflow

You must commit and push incrementally throughout development.

Do not wait until the entire project is complete before committing.

Do not create one giant commit.

Commit only stable, coherent milestones.

Before every commit:

```bash
pnpm format
pnpm lint
pnpm typecheck
```

Also run relevant tests for the changed area.

Do not commit known-broken code.

Do not push failing milestones unless the commit is clearly marked as experimental on a non-default branch. Prefer keeping `main` stable.

Push after every meaningful tested milestone.

Reasonable commit intervals include:

- project foundation completed;
- protocol package completed;
- daemon authentication completed;
- extension connection completed;
- browser navigation completed;
- page snapshot completed;
- browser interactions completed;
- MCP tools completed;
- CLI completed;
- permissions completed;
- remote pairing completed;
- tests completed;
- documentation completed;
- CI completed;
- release preparation completed.

Suggested commit sequence:

```text
chore: initialize conduit monorepo
chore: configure formatting linting and tests
feat(protocol): add versioned message schemas
feat(security): add local authentication primitives
feat(daemon): add authenticated local service
feat(extension): connect extension to local daemon
feat(browser): add tab and navigation operations
feat(browser): add structured page snapshots
feat(browser): add interaction operations
feat(mcp): expose conduit browser tools
feat(cli): add daemon and browser commands
feat(security): add permission and domain policies
feat(remote): add secure device pairing
test: add daemon and protocol integration coverage
test: add browser extension e2e coverage
docs: add architecture and security documentation
docs: add conduit documentation website
ci: add cross-platform validation
ci: deploy documentation to github pages
chore: prepare initial release
```

After each stable commit:

```bash
git push origin main
```

If a feature requires multiple unstable intermediate commits, use a feature branch:

```bash
git checkout -b feat/<feature-name>
```

Push the branch regularly.

Merge it into `main` only after tests pass.

Do not force-push shared branches.

Do not rewrite public history.

Do not commit:

- `.env`;
- secrets;
- API keys;
- authentication tokens;
- private keys;
- generated certificates containing private material;
- browser profiles;
- personal screenshots;
- audit logs;
- user data;
- dependency directories;
- temporary test output;
- local configuration containing sensitive information.

# GitHub project quality

Configure the repository professionally.

Create:

- clear README;
- open-source license;
- `.gitignore`;
- `.editorconfig`;
- issue templates;
- bug report template;
- feature request template;
- pull request template;
- security policy;
- contributing guide;
- code of conduct;
- dependency update configuration if appropriate;
- GitHub Actions;
- repository topics;
- homepage URL pointing to the deployed documentation website.

Use `gh` to configure repository metadata when possible.

Do not enable automatic merging, releases, or package publication unless they are safely configured.

# Architecture

The system should contain these major components:

```text
MCP clients / CLI clients / remote clients
                    ↓
              Conduit daemon
                    ↓
       authentication and permissions
                    ↓
          browser action coordinator
                    ↓
      authenticated browser extension
                    ↓
       Chromium browser and page context
```

Maintain strict separation between:

- transport;
- protocol;
- authentication;
- authorization;
- browser actions;
- storage;
- logging;
- MCP;
- CLI;
- remote-device connectivity.

# Shared protocol package

Create a single source of truth for all communication.

The protocol must be used by:

- extension;
- daemon;
- MCP server;
- CLI;
- remote clients;
- integration tests.

Define versioned runtime-validated schemas for:

- request envelopes;
- response envelopes;
- events;
- errors;
- authentication;
- protocol negotiation;
- pairing;
- permissions;
- browser targets;
- action parameters;
- action results;
- screenshots;
- page snapshots;
- confirmation requests;
- confirmation responses.

Use:

- request IDs;
- correlation IDs;
- protocol version;
- timestamps;
- stable error codes.

Every inbound message must be validated at runtime.

Suggested error codes:

```text
AUTHENTICATION_REQUIRED
AUTHENTICATION_FAILED
PERMISSION_DENIED
USER_CONFIRMATION_REQUIRED
UNSUPPORTED_PROTOCOL_VERSION
INVALID_REQUEST
TAB_NOT_FOUND
FRAME_NOT_FOUND
ELEMENT_NOT_FOUND
ELEMENT_REFERENCE_EXPIRED
ELEMENT_NOT_INTERACTABLE
NAVIGATION_TIMEOUT
ACTION_TIMEOUT
EXTENSION_DISCONNECTED
DAEMON_UNAVAILABLE
DOMAIN_NOT_ALLOWED
FILE_ACCESS_DENIED
PAIRING_CODE_EXPIRED
DEVICE_REVOKED
RATE_LIMITED
PAYLOAD_TOO_LARGE
INTERNAL_ERROR
```

Provide useful messages without leaking secrets.

# Chromium extension

Create a Chromium Manifest V3 extension.

Target current stable Chrome and Edge where practical.

Include:

- background service worker;
- popup or control panel;
- daemon connection status;
- pairing or local authorization flow;
- domain permission state;
- active sessions;
- current controlled tab;
- visible control indicator;
- emergency disconnect;
- permission management;
- audit log access;
- extension settings;
- content scripts where required.

Request the minimum permissions possible.

Do not request broad host access silently.

Prefer optional host permissions.

Ask for domain access only when required.

Research and document the choice among:

- Chrome Debugger API;
- DevTools Protocol;
- `chrome.scripting`;
- `chrome.tabs`;
- content scripts;
- accessibility information;
- combinations of these APIs.

The extension must reject unauthenticated daemon connections.

The extension must not silently allow arbitrary agents to operate the browser.

# Local daemon

Create a local service called the Conduit daemon.

Responsibilities:

- manage lifecycle;
- accept authenticated extension connections;
- expose MCP;
- expose CLI-accessible operations;
- optionally expose a local HTTP or WebSocket API;
- manage sessions;
- enforce permissions;
- enforce domain policies;
- coordinate confirmations;
- manage audit logs;
- maintain trusted-device records;
- support secure remote pairing;
- provide health checks;
- provide diagnostics;
- reconnect safely;
- shut down gracefully.

Bind only to loopback by default:

```text
127.0.0.1
::1
```

Do not expose the daemon publicly by default.

Generate a secure local authentication identity or token.

Store local state in appropriate operating-system application data directories.

Use restrictive filesystem permissions where supported.

Do not store secrets in source control.

# Browser action engine

Create a transport-independent browser abstraction.

Implement a consistent internal API for:

```text
browser.list_tabs
browser.get_active_tab
browser.open_tab
browser.close_tab
browser.focus_tab
browser.navigate
browser.go_back
browser.go_forward
browser.reload
browser.snapshot
browser.get_visible_text
browser.get_html
browser.query
browser.click
browser.type
browser.clear
browser.select
browser.hover
browser.scroll
browser.press_key
browser.wait_for
browser.screenshot
browser.upload_file
browser.get_downloads
browser.get_cookies
browser.set_cookies
browser.delete_cookies
```

Cookie access must be disabled by default and require elevated permission.

File upload must require:

- explicit authorization;
- path allowlist;
- path normalization;
- traversal prevention;
- file size limits;
- clear audit logging.

Do not expose arbitrary filesystem access.

Do not expose arbitrary shell execution.

# Structured page snapshots

Do not rely only on fragile CSS selectors.

Create structured snapshots containing:

- URL;
- title;
- loading state;
- visible text;
- accessibility-related information;
- interactive elements;
- roles;
- accessible names;
- labels;
- input types;
- safe current values;
- disabled states;
- selected states;
- bounding boxes where practical;
- frame information;
- links;
- buttons;
- form controls;
- stable temporary element references.

Do not return huge raw HTML by default.

Support snapshot modes:

```text
compact
accessibility
visible-text
interactive
full-dom
targeted-subtree
```

Generate temporary identifiers:

```text
e1
e2
e3
```

Allow:

```json
{
  "elementId": "e3"
}
```

Handle stale references clearly after rerendering or navigation.

Support fallback targeting by:

1. temporary element ID;
2. role and accessible name;
3. label;
4. text;
5. CSS selector;
6. XPath when unavoidable;
7. coordinates only as a last resort.

# Dynamic websites

Design for:

- React rerenders;
- Vue rerenders;
- Angular rerenders;
- delayed elements;
- SPA navigation;
- iframes;
- nested frames;
- shadow DOM;
- popups;
- new tabs;
- downloads;
- browser dialogs where supported.

Implement the reliable subset.

For unsupported scenarios:

- return a precise error;
- document the limitation;
- do not fake success.

# MCP server

Implement a standards-compliant MCP server.

Expose strongly typed tools including:

```text
conduit_status
conduit_doctor
browser_list_tabs
browser_get_active_tab
browser_open_tab
browser_close_tab
browser_focus_tab
browser_navigate
browser_go_back
browser_go_forward
browser_reload
browser_snapshot
browser_get_visible_text
browser_click
browser_type
browser_clear
browser_select
browser_hover
browser_scroll
browser_press_key
browser_wait_for
browser_screenshot
browser_upload_file
browser_get_downloads
```

Each tool description must explain:

- what it does;
- required inputs;
- optional inputs;
- returned structure;
- required permissions;
- risks;
- likely errors;
- safety behavior.

Do not expose unrestricted JavaScript execution by default.

If JavaScript evaluation is implemented:

- mark it experimental;
- disable it by default;
- require an explicit dangerous permission;
- document the risk;
- test the authorization boundary.

# CLI

Create a CLI named:

```bash
conduit
```

Implement commands such as:

```bash
conduit start
conduit stop
conduit restart
conduit status
conduit doctor
conduit logs
conduit mcp
conduit pair
conduit devices
conduit revoke
conduit permissions
conduit allow-domain
conduit deny-domain
conduit config
conduit extension path
conduit extension install-help
```

Direct browser commands:

```bash
conduit browser tabs
conduit browser active
conduit browser open https://example.com
conduit browser navigate https://example.com
conduit browser snapshot
conduit browser text
conduit browser click --element e3
conduit browser type --element e4 --text "hello"
conduit browser screenshot
```

The CLI must:

- support human-readable output;
- support JSON output;
- use meaningful exit codes;
- provide useful errors;
- work in Windows PowerShell;
- work on Linux;
- work on macOS;
- avoid Unix-only assumptions.

# Secure remote-device connection

Support connecting a trusted remote agent device to the browser-host machine.

Remote access must be disabled by default.

Never implement an unauthenticated LAN socket.

## Default behavior

- loopback only;
- no public exposure;
- no automatic router configuration;
- no automatic port forwarding;
- no public relay;
- no remote connectivity without explicit enablement.

## Pairing workflow

Implement a secure pairing process:

1. Host runs:

```bash
conduit pair
```

2. Conduit generates a short-lived pairing code or QR-compatible payload.
3. Remote client submits the pairing request.
4. Devices exchange public identities.
5. Host displays:

   - device name;
   - device fingerprint;
   - requested permissions;
   - expiration.

6. Host explicitly approves or denies.
7. Revocable device credentials are stored locally.
8. Future connections authenticate using device credentials.
9. Pairing code cannot be reused.
10. Revoked devices cannot reconnect.

Use well-established cryptographic libraries and protocols.

Do not invent custom cryptography.

Prefer mature approaches involving:

- TLS;
- mTLS;
- Noise Protocol Framework;
- libsodium;
- WebCrypto;
- authenticated key exchange.

Document:

- threat model;
- identity model;
- credential storage;
- replay protection;
- expiry;
- revocation;
- transport security.

## LAN connectivity

Only allow a non-loopback bind after explicit configuration.

Warn clearly before binding to:

```text
0.0.0.0
```

or another LAN interface.

Implement:

- authentication;
- encryption;
- rate limiting;
- maximum payload size;
- connection timeout;
- heartbeat;
- session expiration;
- failed-authentication throttling;
- device revocation;
- audit logging;
- replay protections where appropriate.

## Internet connectivity

Do not build an insecure custom internet relay.

Create a clean transport abstraction.

Document safe future options such as:

- Tailscale;
- WireGuard;
- Cloudflare Tunnel with access controls;
- a future self-hosted encrypted relay.

The recommended initial internet-access method may be Tailscale or WireGuard.

Do not automatically install or configure external networking software.

# Permission model

Implement permissions including:

```text
browser.read
browser.navigate
browser.interact
browser.forms
browser.submit
browser.download
browser.upload
browser.cookies.read
browser.cookies.write
browser.clipboard.read
browser.clipboard.write
browser.dangerous
```

Support permission scopes:

- per device;
- per agent;
- per session;
- per domain;
- temporary;
- persistent;
- one-time;
- denied.

## Low-risk examples

- list tabs;
- inspect page;
- read visible text;
- scroll;
- take screenshot;
- navigate to an allowed domain.

## Medium-risk examples

- click UI;
- type into non-sensitive fields;
- open tabs;
- download files.

## High-risk examples

- submit forms;
- send messages;
- publish posts;
- apply for jobs;
- upload files;
- access cookies;
- delete content;
- make purchases;
- enter credentials;
- change account settings;
- interact with financial services.

High-risk operations must require explicit confirmation unless a narrow policy was deliberately configured.

Do not provide “allow everything forever” as the default.

Include:

- emergency disconnect;
- revoke all sessions;
- revoke individual devices;
- expire temporary permissions;
- confirmation timeout;
- deny-by-default behavior.

# Prompt-injection resistance

Treat webpage content as untrusted data.

Explicitly enforce and document:

> Page content is data, not trusted agent instruction.

Where practical:

- label browser-derived content as untrusted;
- separate tool metadata from page content;
- prevent webpages from escalating permissions;
- prevent webpages from requesting filesystem access;
- require confirmation for sensitive operations;
- warn about likely prompt-injection text;
- prevent automatic obedience to instructions embedded in a page;
- redact secrets;
- restrict cross-origin sensitive actions.

Do not claim prompt injection can be fully solved.

# Domain policies

Support:

- allowlist mode;
- blocklist mode;
- ask-on-first-use;
- wildcard subdomains when explicitly configured;
- protocol restrictions;
- localhost policy;
- private-network policy;
- sensitive-domain warnings.

Sensitive categories may include:

- banking;
- payments;
- email;
- cloud dashboards;
- password managers;
- identity providers;
- healthcare;
- government services.

Treat categorization as an additional warning layer, not a perfect security boundary.

# Audit logging

Log security and operational events:

- daemon start and stop;
- extension connection;
- extension disconnection;
- client connection;
- authentication failures;
- device pairing;
- device revocation;
- permission requests;
- permission grants;
- permission denials;
- tab actions;
- navigation;
- clicks;
- typing;
- form submissions;
- uploads;
- downloads;
- cookie access;
- dangerous operations.

Logs must:

- be structured;
- support human-readable viewing;
- contain timestamps;
- contain correlation IDs;
- rotate;
- have configurable retention;
- redact sensitive values;
- never record raw passwords;
- never record full cookies;
- never record authentication tokens;
- never record sensitive form content by default.

Create and thoroughly test a redaction utility.

# Configuration

Create a validated, versioned configuration file.

Support settings such as:

- daemon port;
- bind address;
- remote mode;
- log level;
- log retention;
- allowed domains;
- blocked domains;
- confirmation policy;
- upload allowlist;
- download behavior;
- screenshot directory;
- maximum message size;
- session timeout;
- trusted devices;
- permission defaults.

Provide safe defaults.

Provide a documented example configuration without real credentials.

# Storage

Store local state securely.

Potential state:

- daemon identity;
- local authentication token;
- trusted-device public keys;
- device grants;
- domain policies;
- user settings;
- audit log metadata.

Never store raw browser passwords.

Never store raw session cookies unnecessarily.

Use platform-appropriate storage directories.

Use restrictive file permissions where possible.

Create a storage abstraction to support future improvements.

# Reliability

Implement:

- reconnection with exponential backoff;
- request timeouts;
- cancellation;
- graceful shutdown;
- stale-session cleanup;
- queue limits;
- payload limits;
- heartbeat;
- duplicate request protection where relevant;
- health checks;
- diagnostics;
- structured errors.

`conduit doctor` should verify:

- Node version;
- package manager;
- configuration validity;
- storage permissions;
- daemon port;
- daemon reachability;
- extension build;
- extension connectivity;
- MCP availability;
- remote-mode safety;
- documentation build state where practical.

# Testing requirements

Testing is mandatory.

## Unit tests

Test:

- protocol validation;
- error serialization;
- permission evaluation;
- domain matching;
- configuration parsing;
- log redaction;
- local authentication;
- pairing-code expiry;
- trusted-device storage;
- device revocation;
- session expiry;
- rate limiting;
- element references;
- command parsing;
- path validation;
- payload limits.

## Integration tests

Test:

- daemon startup;
- daemon shutdown;
- extension authentication;
- extension rejection of invalid credentials;
- request-response flow;
- MCP invocation;
- CLI-to-daemon operations;
- reconnection;
- permission denial;
- malformed protocol messages;
- unsupported protocol version;
- remote authentication;
- revoked device rejection;
- configuration loading;
- audit logging.

## Browser end-to-end tests

Use Playwright with a controlled browser profile and loaded extension where technically feasible.

Create fixture pages covering:

- buttons;
- links;
- text inputs;
- forms;
- dropdowns;
- delayed elements;
- dynamic DOM rerenders;
- SPA navigation;
- iframe;
- shadow DOM;
- popup;
- new tab;
- upload;
- download;
- blocked action;
- high-risk confirmation.

Test a real workflow:

1. Start daemon.
2. Launch browser with extension.
3. Authenticate extension.
4. Open fixture page.
5. Retrieve snapshot.
6. identify an element.
7. Click the element.
8. Type into a field.
9. Verify page state.
10. Capture screenshot.
11. Return result through MCP.
12. Return result through CLI.
13. Clean up the browser and daemon.

Do not only assert that mocked methods were called.

## Security tests

Test:

- unauthenticated connection;
- invalid local token;
- expired pairing code;
- reused pairing code;
- revoked device;
- unauthorized remote client;
- oversized payload;
- malformed message;
- blocked domain;
- unauthorized cookie access;
- unauthorized file upload;
- directory traversal;
- unauthorized form submission;
- log-secret redaction;
- rate-limit enforcement;
- disabled remote mode;
- public binding warning;
- stale session;
- invalid permission escalation.

## Cross-platform CI

Run:

- formatting;
- lint;
- type checking;
- unit tests;
- integration tests;
- build;
- CLI smoke tests

on:

- Ubuntu;
- Windows;
- macOS.

Run browser E2E tests on at least Ubuntu if running them on every platform is impractical.

# GitHub Actions

Create workflows for:

1. Main CI
2. Browser E2E tests
3. Security checks
4. Documentation build
5. GitHub Pages deployment
6. Extension package artifact
7. Optional release preparation

The main CI must run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
```

Use package caching appropriately.

Pin trusted GitHub Actions versions.

Use least-privilege workflow permissions.

Do not expose secrets to pull requests from forks.

Upload useful artifacts such as:

- packaged extension;
- test results;
- coverage;
- documentation build;
- Playwright reports when tests fail.

# Documentation website

Create a polished documentation website in:

```text
apps/docs
```

Use a maintained documentation framework, preferably:

- VitePress;
- Astro Starlight;
- Docusaurus;

Choose the lightest option that fits the project.

The documentation website must include:

```text
Home
Getting Started
Installation
Quick Start
Architecture
Browser Extension
Daemon
MCP Server
CLI
Browser Tools
Page Snapshots
Permissions
Domain Policies
Remote Devices
Security
Prompt Injection
Configuration
Testing
Troubleshooting
Development
Contributing
Roadmap
Changelog
```

The website should have:

- clear navigation;
- search if easily supported;
- syntax-highlighted examples;
- architecture diagrams;
- Mermaid diagrams where useful;
- responsive layout;
- light and dark mode;
- GitHub repository link;
- edit-page links where supported;
- version or project-status notice;
- security warning;
- installation commands;
- working internal links;
- no placeholder pages.

Create a useful home page with:

- project tagline;
- project explanation;
- major features;
- security-first positioning;
- architecture diagram;
- quick-start commands;
- supported clients;
- project status;
- GitHub link.

# GitHub Pages deployment

Deploy the documentation website using GitHub Pages.

Create a GitHub Actions workflow such as:

```text
.github/workflows/docs.yml
```

The workflow should:

1. Trigger on changes to documentation and relevant packages.
2. Support manual dispatch.
3. Install dependencies with a frozen lockfile.
4. Build the documentation.
5. Upload the GitHub Pages artifact.
6. Deploy to GitHub Pages.
7. Use official GitHub Pages actions.
8. Use least-privilege permissions.
9. Avoid requiring custom secrets.

Configure the documentation base path correctly for the repository name.

For example, if the repository is:

```text
https://github.com/<owner>/conduit
```

the site may be:

```text
https://<owner>.github.io/conduit/
```

Ensure asset paths work under the repository subpath.

Use `gh` to enable or inspect GitHub Pages where possible.

After deployment:

- verify the deployment workflow succeeded;
- verify the website loads;
- verify styles and assets load;
- verify internal navigation;
- update the repository homepage URL;
- add the documentation URL to README;
- report the final URL.

If immediate GitHub Pages enablement cannot be completed through CLI, configure the workflow fully and document the single required repository-setting step.

Do not deploy the daemon or extension as a cloud service.

Only the documentation website should be hosted publicly.

# Root development scripts

Provide consistent scripts:

```bash
pnpm install
pnpm build
pnpm dev
pnpm clean
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm test:coverage
pnpm docs:dev
pnpm docs:build
pnpm extension:dev
pnpm extension:build
pnpm extension:package
pnpm daemon:start
pnpm daemon:dev
pnpm mcp:start
pnpm conduit:doctor
```

Ensure root commands work.

# Coding standards

Use:

- TypeScript strict mode;
- explicit public API types;
- discriminated unions;
- runtime validation at trust boundaries;
- small focused modules;
- descriptive names;
- clear package boundaries;
- dependency injection where useful;
- comments explaining decisions;
- structured errors;
- deterministic tests.

Avoid:

- `any`;
- hidden global state;
- giant manager classes;
- circular imports;
- silent catches;
- vague booleans;
- huge source files;
- unnecessary factories;
- premature plugin systems;
- copied code without adaptation;
- unsafe type assertions;
- unnecessary abstraction layers.

# Documentation files

Create:

## README.md

Include:

- project explanation;
- current status;
- feature summary;
- architecture;
- security warning;
- prerequisites;
- installation;
- extension setup;
- daemon usage;
- MCP setup;
- CLI usage;
- remote pairing;
- testing;
- development setup;
- known limitations;
- documentation website link;
- roadmap;
- contributing;
- license.

## ARCHITECTURE.md

Explain:

- component boundaries;
- data flow;
- protocol;
- daemon lifecycle;
- extension lifecycle;
- session lifecycle;
- browser action engine;
- permission system;
- remote pairing;
- storage;
- threat boundaries;
- tradeoffs.

## SECURITY.md

Explain:

- threat model;
- trusted components;
- untrusted components;
- webpage prompt injection;
- local authentication;
- remote authentication;
- permission model;
- credential handling;
- logs;
- reporting vulnerabilities;
- supported versions.

## CONTRIBUTING.md

Explain:

- setup;
- architecture expectations;
- test expectations;
- code style;
- commit style;
- pull requests;
- adding browser tools;
- updating protocol schemas;
- security review requirements.

# Autonomous execution phases

Follow this order.

## Phase 1: Environment and repository inspection

Inspect:

```bash
node --version
pnpm --version
git --version
gh --version
gh auth status
git status
git remote -v
```

Inspect all existing files before modifying anything.

Do not destroy unrelated work.

## Phase 2: Architecture plan

Create a concise implementation plan covering:

- component structure;
- browser-control method;
- protocol;
- authentication;
- permissions;
- storage;
- testing;
- remote pairing;
- documentation deployment.

Then proceed immediately.

## Phase 3: GitHub repository

Initialize Git if needed.

Create or connect the GitHub repository.

Add initial repository metadata.

Create and push the first stable commit.

## Phase 4: Monorepo foundation

Create:

- workspaces;
- TypeScript configs;
- linting;
- formatting;
- tests;
- base scripts;
- CI skeleton.

Run checks.

Commit and push.

## Phase 5: Protocol

Build:

- versioned schemas;
- requests;
- responses;
- errors;
- authentication messages;
- pairing messages;
- permission messages;
- tests.

Commit and push.

## Phase 6: Local security and daemon

Build:

- daemon lifecycle;
- local binding;
- local authentication;
- extension connection;
- health checks;
- logs;
- shutdown;
- tests.

Commit and push.

## Phase 7: Extension

Build:

- Manifest V3 extension;
- connection workflow;
- UI;
- permission controls;
- emergency disconnect;
- domain access;
- tests.

Commit and push.

## Phase 8: Working browser vertical slice

Implement and prove:

- list tabs;
- open tab;
- navigate;
- snapshot;
- click;
- type;
- screenshot.

Run an actual browser test.

Commit and push only after it works.

## Phase 9: MCP and CLI

Expose the vertical slice through MCP and CLI.

Test both.

Commit and push.

## Phase 10: Permission system

Implement:

- risk levels;
- domain policies;
- confirmation;
- temporary grants;
- denial;
- audit logging;
- redaction.

Commit and push.

## Phase 11: Remote devices

Implement:

- disabled-by-default remote mode;
- secure pairing;
- trusted identity;
- permissions;
- revocation;
- expiry;
- rate limiting;
- tests.

Do not weaken local security.

Commit and push.

## Phase 12: Expanded browser operations

Add reliable support for:

- clear;
- select;
- hover;
- scroll;
- key presses;
- waits;
- navigation history;
- uploads;
- downloads;
- frames;
- shadow DOM where practical;
- stale-reference recovery.

Commit logical groups separately and push each stable group.

## Phase 13: E2E and security testing

Create fixtures.

Run real browser workflows.

Fix discovered problems.

Commit and push.

## Phase 14: Documentation website

Build complete documentation.

Run:

```bash
pnpm docs:build
```

Fix all broken links, warnings, and asset issues.

Commit and push.

## Phase 15: GitHub Pages

Create the GitHub Pages workflow.

Push it.

Monitor the Actions run using `gh`.

Inspect failures and fix them autonomously.

Verify the published site.

Set repository homepage URL.

Commit and push any fixes.

## Phase 16: CI stabilization

Run and monitor GitHub Actions.

Use commands such as:

```bash
gh run list
gh run view
gh run watch
```

Investigate failures.

Fix failures.

Commit and push fixes.

Do not leave `main` with known failing CI.

## Phase 17: Final audit

Review the project as an external maintainer.

Look for:

- weak authentication;
- accidental public binding;
- broad extension permissions;
- secrets;
- path traversal;
- unsafe uploads;
- race conditions;
- flaky tests;
- fake tests;
- dead code;
- misleading documentation;
- broken website links;
- Windows incompatibilities;
- incomplete TODOs;
- weak error messages;
- dependency vulnerabilities.

Run:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
pnpm extension:package
```

Run CLI and MCP smoke tests.

Run relevant GitHub Actions.

Commit and push final fixes.

# Completion criteria

The initial milestone is complete only when:

- GitHub repository exists;
- repository remote is configured;
- logical incremental commits exist;
- stable milestones were pushed regularly;
- `main` is not knowingly broken;
- extension builds;
- daemon starts;
- extension authenticates;
- tabs can be listed;
- pages can be opened;
- pages can be navigated;
- structured snapshots work;
- element clicking works;
- text entry works;
- screenshots work;
- MCP tools work;
- CLI commands work;
- permissions are enforced;
- high-risk actions are protected;
- remote access is disabled by default;
- secure remote pairing works or is clearly marked experimental;
- device revocation works;
- unit tests pass;
- integration tests pass;
- security tests pass;
- browser E2E tests pass;
- build passes;
- packaged extension is generated;
- documentation website builds;
- GitHub Pages workflow exists;
- documentation website is deployed or the only unavoidable manual step is clearly documented;
- GitHub Actions pass;
- README links to documentation;
- repository homepage points to documentation;
- known limitations are honest;
- no secrets are committed.

# Handling incomplete advanced features

When a difficult feature cannot be implemented safely:

1. Do not fake it.
2. Do not weaken security.
3. Keep the core system working.
4. Exclude it or place it behind an experimental flag.
5. Document the limitation.
6. Explain the blocker.
7. Add tests for the supported behavior.
8. Create a GitHub issue if appropriate.
9. Continue with the rest of the project.

A secure, working partial feature is better than an unsafe feature labeled complete.

# Final report

At the end, provide a detailed report containing:

1. GitHub repository URL
2. Documentation website URL
3. What was implemented
4. Architecture summary
5. Repository structure
6. Major technical decisions
7. Browser-control approach
8. Security model
9. Permission model
10. Remote-pairing design
11. Supported browser operations
12. MCP tools
13. CLI commands
14. Tests executed
15. Test results
16. Build results
17. GitHub Actions results
18. Extension packaging result
19. GitHub Pages deployment result
20. Known limitations
21. Remaining TODOs
22. Security concerns
23. Important files to study first
24. Exact local setup commands
25. Exact extension installation steps
26. Exact MCP configuration
27. Exact remote pairing example
28. Git commit history summary
29. Branches created
30. Push milestones completed
31. Final `git status`
32. Latest commit hash
33. Whether `main` is passing CI

Do not only report that files were generated.

Demonstrate that the system was built, run, tested, committed, pushed, and documented.

# Final behavioral requirements

- Work autonomously.
- Inspect before modifying.
- Do not stop after scaffolding.
- Do not ask unnecessary questions.
- Make reasonable decisions and continue.
- Build the vertical slice first.
- Test every stable milestone.
- Commit at meaningful intervals.
- Push stable commits regularly.
- Keep `main` working.
- Use feature branches for unstable work when useful.
- Monitor GitHub Actions.
- Fix CI failures.
- Build and deploy the documentation website.
- Use GitHub Pages.
- Do not expose secrets.
- Do not expose unauthenticated ports.
- Do not add arbitrary shell execution.
- Do not allow arbitrary JavaScript execution by default.
- Do not fake unsupported features.
- Keep the code understandable for a maintainer who intends to study and expand it.
- Prefer a smaller reliable system over a large unstable system.

Begin by inspecting the environment, Git status, GitHub authentication, and existing files. Then create the architecture plan and immediately begin implementation.
