# Permissions

Conduit denies capabilities that are not explicitly granted. Defaults contain only `browser.read`.

Available permission names include:

```text
browser.read          browser.navigate       browser.interact
browser.forms         browser.submit         browser.download
browser.upload        browser.cookies.read   browser.cookies.write
browser.clipboard.read browser.clipboard.write browser.dangerous
```

The schema reserves permissions beyond the currently exposed tool set. Cookie, clipboard, submit-specific, and dangerous APIs are not presently exposed as general browser tools.

## Configure grants

```bash
conduit permissions
conduit config set security.permissions '["browser.read","browser.navigate"]'
conduit restart
```

Remote devices receive their own subset when approved. A device grant cannot elevate beyond the host's local policy.

## Confirmations

High-risk operations such as upload require a short-lived confirmation even when the permission is present. Confirmations are scoped to the operation, expire, and are consumed once. Filesystem path inspection occurs only after permission and confirmation succeed.

Conduit does not provide “allow everything forever” as the default.
