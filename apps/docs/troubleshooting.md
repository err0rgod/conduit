# Troubleshooting

Start with:

```bash
conduit --json doctor
conduit status
conduit logs --lines 200
```

## Extension disconnected

Confirm the daemon is running, the popup port matches configuration, and the token was copied from `conduit extension token`. Reload the unpacked extension after rebuilding it. Never post the token in an issue.

## Permission or domain denied

Run `conduit permissions`. Add only the required permission and domain, then restart. Localhost has a separate opt-in even when listed as a domain.

## Confirmation required

The action is intentionally paused. Review the operation and domain through the CLI confirmation flow. Retrying without the approved confirmation ID creates a new request.

## Stale element reference

Capture a new interactive snapshot. React/Vue/Angular rerenders can replace nodes even when the page looks unchanged.

## Daemon will not stop

Conduit refuses to signal a PID when the live instance ID does not match its state file. Inspect `status` and logs first. Use `conduit stop --force` only after verifying the PID belongs to Conduit.

## E2E browser does not launch

Install the Playwright Chromium binary and ensure a desktop session is available. Corporate policies may prevent unpacked extension loading.
