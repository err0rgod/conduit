# MCP Server

Conduit includes a standards-based Model Context Protocol server over stdio.

```bash
conduit mcp
```

## Client configuration

Use an absolute path when the CLI is not globally linked:

```json
{
  "mcpServers": {
    "conduit": {
      "command": "node",
      "args": ["/absolute/path/to/conduit/packages/cli/bin/conduit.js", "mcp"]
    }
  }
}
```

The MCP process is an adapter; the daemon and extension must already be connected. `conduit_status` can be called before browser tools.

## Safety behavior

Tool inputs are described with JSON Schema and translated into the shared versioned protocol. Daemon errors are returned as MCP error content rather than hidden. Page snapshots and visible text are explicitly described as untrusted data. There is no arbitrary JavaScript evaluator or shell tool.

Implemented MCP tools cover status, tabs, navigation, snapshots, visible text, click/type/clear/select, hover/scroll/keyboard, waits, screenshots, uploads, and download observation. See [Browser Tools](/browser-tools).
