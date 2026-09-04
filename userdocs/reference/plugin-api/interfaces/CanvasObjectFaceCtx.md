[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasObjectFaceCtx

# Interface: CanvasObjectFaceCtx

## Properties

### mirror?

```ts
optional mirror?: object;
```

For a file-source object: the mirrored file's current bytes as a
data: URL once loaded (null while loading), and whether the read
failed. Binary files (images, sheets, pdf) are base64 data: URLs
with their MIME type; text files (markdown source, json, csv,
.env) are text/plain data: URLs, percent-encoded. renderFace
re-runs when either changes. Absent for board-local and url
objects.

#### dataUrl

```ts
dataUrl: string | null;
```

#### failed

```ts
failed: boolean;
```

***

### mountOffBoard

```ts
mountOffBoard: (el, size) => () => void;
```

mountOffBoard attaches el to the document OFF the board, at exactly
`size` CSS pixels and unscaled by the board's zoom, and returns the
detach. The face's own el is CSS-scaled with the canvas, so an
engine that measures and fits its layout from screen rectangles
(a mind-map or graph layout, a text-measuring chart) lays out wrong
in place -- render it on this stage at the face's size, copy the
finished drawing into el, detach. Anything still mounted when the
face unmounts is detached by the host.

#### Parameters

##### el

`Element`

##### size

###### h

`number`

###### w

`number`

#### Returns

() => `void`

***

### object

```ts
object: object;
```

#### ID

```ts
ID: string;
```

#### Kind

```ts
Kind: string;
```

#### Payload

```ts
Payload: Record<string, string>;
```

#### Size

```ts
Size: 
  | {
  H: number;
  W: number;
}
  | null;
```

The object's persisted size in board units, or null until the
user first resizes it (the wire shape's own convention).

***

### onThemeChange

```ts
onThemeChange: PluginThemeSubscribe;
```

onThemeChange registers cb for every later appearance change.

***

### requestGuardedAction

```ts
requestGuardedAction: (kind, attributes, description) => Promise<GuardedActionResult>;
```

requestGuardedAction asks Mill to perform an action the plugin
cannot perform itself. The action kind must be declared in the
plugin's manifest capabilities; each use is evaluated by the
owner's guardrail rules and may require live approval.

#### Parameters

##### kind

`string`

##### attributes

`Record`\<`string`, `string`\>

##### description

`string`

#### Returns

`Promise`\<[`GuardedActionResult`](GuardedActionResult.md)\>

***

### theme

```ts
theme: PluginTheme;
```

The appearance this face is rendering under.

***

### updatePayload

```ts
updatePayload: (patch) => Promise<void>;
```

updatePayload merges patch into this object's payload through the
host (an empty string deletes a key). The write persists, syncs,
and participates in undo like any built-in edit.

#### Parameters

##### patch

`Record`\<`string`, `string`\>

#### Returns

`Promise`\<`void`\>
