# CLI

The `conduit` CLI provides human-readable output by default and JSON with the global `--json` flag.

```bash
conduit --json status
conduit --json browser tabs
```

## Command groups

| Area          | Commands                                                      |
| ------------- | ------------------------------------------------------------- |
| Setup         | `setup`, `upgrade`, `uninstall`                               |
| Lifecycle     | `start`, `stop`, `restart`, `status`, `logs`, `doctor`        |
| User service  | `service install`, `start`, `stop`, `status`, `uninstall`     |
| Pairing       | `pair`, `devices`, `revoke`                                   |
| Policy        | `permissions`, `allow-domain`, `deny-domain`                  |
| Configuration | `config show`, `config path`, `config set`                    |
| Extension     | `extension path`, `extension token`, `extension install-help` |
| Clients       | `mcp`, `browser …`                                            |

Run `conduit <command> --help` for exact options. Browser commands accept tab IDs and snapshot element targets where relevant.

## Exit behavior

Successful commands resolve with exit code zero. Validation, connectivity, and daemon errors are printed without swallowing the underlying structured error. JSON output is recommended for scripts.

## Setup and automatic startup

`conduit setup` is idempotent and uses a user-level service. It does not require
administrator access. Settings survive `conduit uninstall` unless `--purge` is
explicitly supplied.

## Cross-platform notes

Lifecycle management uses Node process APIs and explicit file paths rather than
Unix-only shell commands. Automatic startup uses a limited Scheduled Task on
Windows, a LaunchAgent on macOS, and a systemd user unit on Linux. Definition and
command generation are covered by cross-platform tests, and the packaged lifecycle
runs in the Windows, macOS, and Linux CI matrix.
