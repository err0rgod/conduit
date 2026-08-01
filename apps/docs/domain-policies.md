# Domain Policies

Domain policy is an additional boundary applied to navigation and known tab URLs.

## Modes

- `ask` (default): an unknown domain needs confirmation;
- `allowlist`: only explicitly allowed patterns pass;
- `blocklist`: all valid web domains pass except explicit blocks and network restrictions.

```bash
conduit allow-domain example.com
conduit allow-domain '*.example.org'
conduit deny-domain accounts.example.com
conduit config set security.domainMode '"allowlist"'
conduit restart
```

Wildcard entries match subdomains only. `*.example.com` does not match the bare `example.com`; add both when both are intended.

Only HTTP and HTTPS are accepted. Localhost and private-network hosts are denied unless their separate settings are enabled. This prevents a webpage workflow from casually pivoting into local services.

Domain categories such as banking or email are not treated as a perfect security oracle. Narrow allowlists and explicit confirmation remain the dependable controls.
