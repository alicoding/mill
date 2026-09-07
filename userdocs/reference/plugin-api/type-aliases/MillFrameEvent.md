[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / MillFrameEvent

# Type Alias: MillFrameEvent

```ts
type MillFrameEvent = 
  | "theme:changed"
  | "settings:changed"
  | "contents:changed"
  | "ctx"
  | "resize";
```

The events Mill pushes into an entry page.

`theme:changed` carries the resolved appearance; Mill has already
swapped the page's own theme variables by the time it fires, so
only a page that paints pixels itself needs to listen.
`settings:changed` says a stored setting moved; read the new value
with `call('settings.get', key)`. `contents:changed` says the board
changed. `ctx` carries the surface's context, on mount and on every
change: a capture's destination arrives here, and a canvas object's
face receives `{ object: { ID, Kind, Payload, Size }, mirror? }` --
`mirror` only for a file-backed kind, as `{ dataUrl, failed }`.
`resize` carries the `{ width, height }` of the box the page is
drawn in.
