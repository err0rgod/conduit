# Remote Devices

Remote access is disabled by default. The initial implementation provides device identity, pairing, revocation, scoped sessions, and TLS-gated non-loopback binding; it does not provide a public relay.

## Pairing model

1. The host runs `conduit pair` and receives a short-lived one-use code.
2. A remote client submits its name, P-256 public key, and requested permissions.
3. The host reviews the fingerprint and approves a permission subset.
4. The client proves possession of the private key by signing a fresh challenge.
5. The daemon issues a short-lived session token bound to the device grants.

Pairing codes expire and cannot be reused. Challenges are digest-bound and one-use. Revocation invalidates active sessions.

```bash
conduit pair
conduit devices
conduit revoke <device-id>
```

## Network transport

Non-loopback binding requires `remote.enabled: true` plus TLS key and certificate paths. Use a trusted private network such as Tailscale or WireGuard for internet reachability. Conduit will not install or configure those products for you.

Protect the device private key using the remote operating system's secure storage. Conduit stores only the trusted public identity on the browser host.
