# Security Policy

## Supported versions

Conduit is pre-1.0 and has not published a supported release line. Security fixes are applied to the latest `main` branch. Do not assume older commits receive patches.

## Report a vulnerability

Please do not open a public issue, discussion, or pull request containing an unpatched vulnerability, exploit, token, private key, browser data, or personal screenshot.

Use GitHub's private vulnerability reporting for this repository:

`https://github.com/err0rgod/conduit/security/advisories/new`

Include the affected commit, platform/browser, impact, minimal reproduction, and any suggested mitigation. Remove real credentials and user data. If private reporting is unavailable, open a public issue containing only a request for a private security contact—no vulnerability details.

We will acknowledge a report when maintainers are available, investigate it, coordinate a fix, and credit reporters who want attribution. No response-time SLA is promised for this volunteer pre-release project.

## Threat model

Trusted:

- the local operating-system account and host administrator;
- the explicitly configured Conduit code and extension build;
- deliberate operator confirmations and device approvals.

Untrusted:

- webpages, DOM text, accessibility names, downloads, and prompt-like content;
- unauthenticated local/remote clients and all network input;
- agent-supplied operation arguments until validated;
- file paths until normalized and allowlisted;
- remote devices beyond their approved public identity and grants.

## Security properties

- loopback-only binding and remote-disabled defaults;
- two separate local credentials (agent token and extension credential) with split authority, see "Local credentials";
- runtime validation at protocol/config boundaries;
- deny-by-default capability and domain checks;
- per-site browser host grants by default, with broad host access available only through an explicit popup click;
- local-only `security.domainMode: "allow-all"` is rejected with remote mode and does not bypass blocked domains or network guards;
- expiring one-time high-risk confirmations;
- bounded messages, queues, timeouts, replay windows, sessions, and auth attempts;
- TLS-gated non-loopback bind;
- one-use pairing, P-256 proof-of-possession, short remote sessions, and revocation;
- upload allowlists, canonical path containment, file checks, and size bounds;
- audit redaction for token/password/cookie/text/value-like fields.

## Prompt injection

Page content is data, not trusted agent instruction. Conduit prevents webpage text from changing permissions or confirmation state, but cannot guarantee that an AI agent will interpret malicious content safely. Webpages also cannot trigger the extension's broad host request or enable daemon `allow-all`; those remain explicit operator actions. Operators should use narrow grants and require human review for consequential actions.

## Opt-in access expansion

The extension and daemon expose separate authority gates. The extension's **Allow all sites** control requests exactly `http://*/*` and `https://*/*` from a popup click and the browser's native prompt. Conduit does not persist a parallel flag, and background code never requests those origins. The control can be revoked with **Revoke all sites**.

Native Messaging accepts only configured extension identities. The unpacked Chromium build, published Chrome Web Store build (`gjhipjgiapijcdnflldnoenafeegmfpc`), and Firefox build have trusted default IDs. Future Edge or other store IDs are explicitly added with `conduit extension trust <id>`; the native host never accepts arbitrary extension origins.

The backend's `security.domainMode: "allow-all"` is intentionally local-only and never the default. It requires `conduit restart` after configuration changes and cannot be combined with `remote.enabled: true`. Even when enabled, invalid URLs, non-HTTP(S) protocols, blocked domains, localhost without its opt-in, and private networks without their opt-in remain denied.

## Secret handling

Never commit or share local tokens, remote private keys, TLS private keys, browser profiles, cookies, audit logs, or screenshots containing user data. Conduit does not need raw browser passwords.

## Local credentials

Conduit keeps two independent random 256-bit credentials in the user's application-data directory:

| Credential           | File                  | Given to                                 | Authority                                                                                                                 |
| -------------------- | --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Agent token          | `auth.json`           | MCP server, CLI, other agent clients     | `/api/action`, list endpoints, device revoke, shutdown, pairing start, and _denying_ confirmations/pairings               |
| Extension credential | `extension-auth.json` | The browser extension (Native Messaging) | The extension WebSocket slot, approving confirmations and pairings (HTTP, operator commands), and listing pending reviews |

- Native Messaging and the legacy `/api/extension/pair` flow hand out only the extension credential. The agent token is never sent to the browser.
- The extension WebSocket accepts only the extension credential. A connection that presents the agent token is rejected with `AUTHENTICATION_FAILED`, an explanatory message, and a `extension.authentication` audit event (`reason: agent-token-presented`). It cannot displace a connected extension.
- Approving a confirmation or a remote-device pairing with the agent token returns `403 PERMISSION_DENIED`. Denying is allowed with either credential because it only reduces privilege. The extension credential cannot call `/api/action`, shut the daemon down, or start pairings.
- `conduit pair approve` is a human operator command: it reads the extension credential from disk, refuses to run when stdin is not an interactive terminal, shows the device name, fingerprint, requested permissions, and expiry, and requires the operator to type the first characters of the fingerprint.
- Optionally, an extension may send a random `nonce` in its `auth` message. The daemon then replies `{"type":"auth_success","proof":"<hex>"}` where `proof = HMAC-SHA256(extensionCredential, "conduit.daemon-proof.v1:" + nonce)`. An extension can verify this to confirm it is talking to a daemon that holds the credential from its native host. The nonce is optional for backward compatibility; the current extension does not yet require it.
- Credential files are created with mode `0600` (directory `0700`) on POSIX and restricted with `icacls` to the current user on Windows. Failures to restrict permissions, and malformed credential files that get regenerated, are reported (stderr and the audit log) rather than ignored.

Honest limits: these files are readable by any process running as the same OS user. A malicious same-user process with shell access can read the extension credential and act as the operator, so this separation is defense in depth against MCP-only or prompt-injected agents and accidental token leakage, not a hard boundary against hostile local code. Use a separate OS account or sandbox for agents you do not trust with shell access.

## Out of scope assumptions

Conduit cannot protect a host with a compromised OS account, a malicious installed extension, or a deliberately overbroad policy. It does not claim complete prompt-injection prevention or safe public-internet exposure without an independently secured network layer.
