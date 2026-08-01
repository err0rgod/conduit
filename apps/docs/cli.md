# CLI

The `conduit` CLI provides human-readable output by default and JSON with the global `--json` flag.

```bash
conduit --json status
conduit --json browser tabs
```

## Command groups

| Area          | Commands                                                      |
| ------------- | ------------------------------------------------------------- |
| Lifecycle     | `start`, `stop`, `restart`, `status`, `logs`, `doctor`        |
| Pairing       | `pair`, `devices`, `revoke`                                   |
| Policy        | `permissions`, `allow-domain`, `deny-domain`                  |
| Configuration | `config show`, `config path`, `config set`                    |
| Extension     | `extension path`, `extension token`, `extension install-help` |
| Clients       | `mcp`, `browser …`                                            |

Run `conduit <command> --help` for exact options. Browser commands accept tab IDs and snapshot element targets where relevant.

## Exit behavior

Successful commands resolve with exit code zero. Validation, connectivity, and daemon errors are printed without swallowing the underlying structured error. JSON output is recommended for scripts.

## Cross-platform notes

Lifecycle management uses Node process APIs and explicit file paths rather than Unix-only shell commands. The same CLI is tested on Windows during development; CI coverage across Windows, macOS, and Linux is part of the repository automation milestone.
