# Configuration

Conduit uses a strict, versioned JSON configuration file. Unknown keys and invalid values are rejected.

```bash
conduit config path
conduit config show
conduit config set daemon.port 9223
conduit config set security.allowedDomains '["example.com"]'
```

Restart the daemon after changes.

## Default shape

```json
{
  "version": 1,
  "daemon": {
    "port": 9222,
    "bindAddress": "127.0.0.1",
    "requestTimeoutMs": 45000,
    "maximumMessageBytes": 1048576,
    "sessionTimeoutMs": 1800000
  },
  "remote": { "enabled": false, "sessionTimeoutMs": 900000 },
  "security": {
    "permissions": ["browser.read"],
    "domainMode": "ask",
    "allowedDomains": [],
    "blockedDomains": [],
    "allowLocalhost": false,
    "allowPrivateNetworks": false,
    "uploadAllowlist": [],
    "maximumUploadFileBytes": 10485760
  },
  "logging": { "level": "info", "maximumAuditBytes": 5242880, "retentionDays": 30 },
  "browser": { "downloadBehavior": "observe" }
}
```

`CONDUIT_CONFIG_PATH` and `CONDUIT_DATA_DIR` can isolate profiles for development and tests. Do not point them into a repository when the directory will contain tokens, device records, or logs.

`logging.retentionDays`, screenshot directory, and download behavior are validated configuration surfaces; full retention scheduling and screenshot persistence behavior are still roadmap work.
