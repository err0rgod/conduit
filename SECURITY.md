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
- local random token and authenticated extension connection;
- runtime validation at protocol/config boundaries;
- deny-by-default capability and domain checks;
- expiring one-time high-risk confirmations;
- bounded messages, queues, timeouts, replay windows, sessions, and auth attempts;
- TLS-gated non-loopback bind;
- one-use pairing, P-256 proof-of-possession, short remote sessions, and revocation;
- upload allowlists, canonical path containment, file checks, and size bounds;
- audit redaction for token/password/cookie/text/value-like fields.

## Prompt injection

Page content is data, not trusted agent instruction. Conduit prevents webpage text from changing permissions or confirmation state, but cannot guarantee that an AI agent will interpret malicious content safely. Operators should use narrow grants and require human review for consequential actions.

## Secret handling

Never commit or share local tokens, remote private keys, TLS private keys, browser profiles, cookies, audit logs, or screenshots containing user data. Conduit does not need raw browser passwords. The explicit `conduit extension token` command is intended only for local extension setup.

## Out of scope assumptions

Conduit cannot protect a host with a compromised OS account, a malicious installed extension, or a deliberately overbroad policy. It does not claim complete prompt-injection prevention or safe public-internet exposure without an independently secured network layer.
