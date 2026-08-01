# Page Snapshots

Snapshots provide bounded, structured page information instead of returning arbitrary HTML by default.

They include the page URL, title, loading state, capture time, visible text, interactive elements, accessible names, roles, labels, safe values, state, bounds where available, and frame metadata. Browser-derived fields are untrusted.

## Modes

- `compact`: concise page summary;
- `accessibility`: accessibility-oriented names and roles;
- `visible-text`: readable visible content;
- `interactive`: controls and links, recommended for action planning;
- `full-dom`: expanded DOM-derived information when supported;
- `targeted-subtree`: scoped capture for a target when supported.

```bash
conduit browser snapshot --mode interactive --tab 42
```

## Element references

Elements receive short IDs such as `e1`, `e2`, and `e3`. These IDs belong to a snapshot generation; navigation and dynamic framework rerenders can make them stale. On failure, capture a new snapshot and retarget semantically.

## Data handling

Snapshots may contain private page text. Do not attach them to public issues without review. Conduit does not claim that automated redaction can identify every sensitive string in arbitrary webpage content.
