# Browser Tools

The CLI and MCP expose the same shared action vocabulary.

| Capability  | Operations                                                              | Permission                      |
| ----------- | ----------------------------------------------------------------------- | ------------------------------- |
| Tabs/read   | list tabs, active tab, snapshot, visible text, wait, screenshot, scroll | `browser.read`                  |
| Navigation  | open, navigate, back, forward, reload                                   | `browser.navigate`              |
| Interaction | close/focus, click, hover, key                                          | `browser.interact`              |
| Forms       | type, clear, select                                                     | `browser.forms`                 |
| Files       | upload                                                                  | `browser.upload` + confirmation |
| Downloads   | observe recent downloads                                                | `browser.download`              |

## Targeting

Prefer targets in this order:

1. temporary `elementId` from the latest snapshot;
2. role plus accessible name;
3. associated label;
4. visible text;
5. CSS selector.

Coordinates and unrestricted XPath/JavaScript are not exposed. Temporary IDs expire after page changes and should be refreshed after navigation or rerendering.

## Examples

```bash
conduit browser snapshot --mode interactive
conduit browser click --element e3
conduit browser type --element e4 "hello"
conduit browser wait --selector '#ready' --timeout 5000
conduit browser screenshot --format png
```

Errors distinguish missing tabs, stale/missing elements, authorization, confirmation, timeout, extension connectivity, and invalid requests.
