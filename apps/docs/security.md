# Security

Conduit assumes the local host and explicitly approved operator are trusted. Agents, remote clients, browser pages, network input, and file paths are untrusted until validated and authorized.

## Default defenses

- loopback-only daemon binding;
- cryptographically random local bearer token stored outside the repository;
- authenticated extension WebSocket;
- Zod validation for protocol and configuration input;
- deny-by-default permissions and domain controls;
- one-time expiring confirmations for high-risk work;
- size, timeout, queue, replay, heartbeat, and rate limits;
- TLS requirement for non-loopback listening;
- P-256 proof-of-possession for trusted devices;
- structured audit events with sensitive-key and token redaction;
- normalized upload allowlists, traversal prevention, and size limits.

## What Conduit cannot guarantee

Conduit cannot make arbitrary webpages trustworthy, identify every prompt injection, prevent a broadly authorized agent from making poor decisions, or secure a compromised operating system/browser extension account. Screenshots and snapshots can contain secrets. Optional debugger access is powerful.

## Reporting vulnerabilities

Do not open public issues for unpatched vulnerabilities. Follow the private reporting instructions in the repository [SECURITY.md](https://github.com/err0rgod/conduit/blob/main/SECURITY.md).

Review [Prompt Injection](/prompt-injection), [Permissions](/permissions), and [Remote Devices](/remote-devices) before sensitive use.
