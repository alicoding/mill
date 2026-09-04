[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasObjectFaceCtx

# Interface: CanvasObjectFaceCtx

## Properties

### mirror?

```ts
optional mirror?: object;
```

For a file-backed object: the mirrored file's current bytes as a
data: URL once loaded (null while loading), and whether the read
failed. Binary files (images, sheets, pdf) arrive as base64 data:
URLs with their MIME type; text files (markdown, json, csv, .env)
arrive as percent-encoded text/plain data: URLs. renderFace re-runs
whenever either changes. Absent for a board-local or url-backed
object.

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

Attaches el to the page OFF the board, at exactly `size` CSS
pixels and unscaled by the board's zoom, and returns the function
that detaches it. A face is CSS-scaled with the canvas, so an
engine that measures its own layout from screen rectangles (a
mind-map or graph layout, a text-measuring chart) lays out wrong
rendered directly in place — render it on this offscreen stage at
the face's real size, then copy the finished drawing into el.
Anything still mounted when the face unmounts is detached
automatically.

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
user first resizes it.

***

### onThemeChange

```ts
onThemeChange: PluginThemeSubscribe;
```

Subscribes to every later appearance change.

***

### requestGuardedAction

```ts
requestGuardedAction: (kind, attributes, description) => Promise<GuardedActionResult>;
```

Asks Mill to perform an action the plugin cannot perform itself.
The action's kind must be one this plugin's manifest declares as a
capability; each use is evaluated by the person's own guardrail
rules and may require their live approval.

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

Merges patch into this object's payload (an empty string value
deletes that key). The write persists, syncs, and participates in
undo like any built-in edit.

#### Parameters

##### patch

`Record`\<`string`, `string`\>

#### Returns

`Promise`\<`void`\>
