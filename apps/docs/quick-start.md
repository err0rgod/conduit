# Quick Start

## 1. Start and connect

```bash
conduit setup
conduit status
conduit doctor
```

The setup report prints the extension directory. Load it in Chromium, then open the
popup and enter the short-lived pairing code and port. `conduit status` should then show
`extensionConnected: true`.

## 2. Grant a narrow workflow

```bash
conduit config set security.permissions '["browser.read","browser.navigate","browser.interact","browser.forms"]'
conduit allow-domain example.com
conduit restart
```

Configuration is validated before it is written. Restart the daemon after policy changes.

## 3. Control a page

```bash
conduit browser open https://example.com
conduit browser tabs
conduit browser snapshot --mode interactive
conduit browser click --element e1
conduit browser screenshot
```

Element IDs such as `e1` are temporary. Capture a new snapshot after navigation or a substantial rerender.

## 4. Connect an MCP client

Configure the client to launch:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/conduit/packages/cli/bin/conduit.js", "mcp"]
}
```

The MCP process reads the same protected local credential and daemon settings. It exposes typed browser tools; it does not execute arbitrary JavaScript or shell commands.

## Stop safely

```bash
conduit stop
```

Conduit verifies the daemon instance identity before stopping it. PID termination is not used unless `--force` is explicitly requested.
