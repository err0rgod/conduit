# Daemon

The daemon is Conduit's local control plane. It serves health and authenticated action endpoints and maintains one authenticated extension WebSocket.

## Lifecycle

```bash
conduit start
conduit status
conduit logs --lines 100
conduit restart
conduit stop
```

Detached-process state contains both a PID and a random daemon instance ID. `stop` checks health and identity before requesting graceful shutdown, preventing an obsolete state file from killing an unrelated process. `--force` is an explicit recovery option.

## Safe binding

The default bind address is `127.0.0.1`. A non-loopback address is rejected unless remote mode is enabled and TLS key/certificate paths are configured. Conduit does not configure routers, tunnels, firewalls, or a public relay.

## Reliability controls

- maximum message body size;
- request timeout and bounded pending queue;
- duplicate request replay window;
- extension authentication deadline and heartbeat;
- extension and remote session expiry;
- authentication and remote-request rate limiting;
- structured shutdown errors and audit events.

## Health and diagnostics

`GET /health` reports daemon status, extension connectivity, and a per-process instance ID. `conduit doctor` additionally checks Node, package manager, configuration, storage, TLS safety, extension/MCP builds, and documentation output.
