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
  | "resize"
  | "face:activate"
  | "face:deactivate";
```

The events Mill pushes into an entry page.

`theme:changed` carries the resolved appearance; Mill has already
swapped the page's own theme variables by the time it fires, so
only a page that paints pixels itself needs to listen.
`settings:changed` says a stored setting moved; read the new value
with `call('settings.get', key)`. `contents:changed` says the board
changed, carrying `{ id, kind }` — `kind` names WHICH family changed
('card', 'note', ...) so a page re-drawing on only some ignores the
rest. `ctx` carries the surface's context, on mount and on every
change: a capture's destination arrives here, and a canvas object's
face receives `{ object: { ID, Kind, Payload, Size }, mirror? }` --
`mirror` only for a file-backed kind, as `{ dataUrl, failed }`.
`resize` carries the `{ width, height }` of the box the page is
drawn in. `face:activate`/`face:deactivate` tell a canvas object's
own face when it has been handed real input: the click shield
already gates every pointer/wheel/key the page itself receives, so
these two name only the moment a page may want to react to (autofocus
a field, and so on) -- a page that never cares may ignore both.
