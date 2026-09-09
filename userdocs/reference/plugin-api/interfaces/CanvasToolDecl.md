[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasToolDecl

# Interface: CanvasToolDecl

A tool Mill drives. `preview` is what Mill draws mid-drag;
`onPointer` is called once per phase, once per frame.

## Properties

### cursor?

```ts
optional cursor?: "crosshair" | "cell" | "copy" | "grab" | "default";
```

The pointer shape while this tool is armed.

***

### description?

```ts
optional description?: string;
```

***

### dragBand?

```ts
optional dragBand?: boolean;
```

***

### editRoute?

```ts
optional editRoute?: CanvasEditRoute;
```

***

### ephemeral?

```ts
optional ephemeral?: boolean;
```

ephemeral: the drag draws a trail and places nothing (a laser
pointer, an eraser).

***

### fadeMs?

```ts
optional fadeMs?: number;
```

For an ephemeral tool: points age out over this many
milliseconds instead of clearing at pointer-up.

***

### group?

```ts
optional group?: "objects" | "media" | "annotate" | "embed";
```

***

### icon

```ts
icon: string;
```

One emoji, or a name from Mill's glyph set.

***

### kind

```ts
kind: string;
```

kind is the tool's tray id and, unless objectKind says otherwise,
the kind every placed instance is stored under.

***

### label

```ts
label: string;
```

***

### lockable?

```ts
optional lockable?: boolean;
```

***

### objectKind?

```ts
optional objectKind?: string;
```

***

### onPointer

```ts
onPointer: (event, ctx) => void | Promise<void>;
```

#### Parameters

##### event

[`CanvasToolPointerEvent`](CanvasToolPointerEvent.md)

##### ctx

[`CanvasToolCtx`](CanvasToolCtx.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### preview?

```ts
optional preview?: CanvasPreviewDecl;
```

***

### renderFace?

```ts
optional renderFace?: (el, ctx) => void;
```

renderFace draws a placed object's board face, for an extension
that runs in Mill's own document. Leave it out and name an entry
page beside the kind in the manifest instead — the sandboxed form,
and the only one available to an extension that runs framed.

#### Parameters

##### el

`HTMLElement`

##### ctx

[`CanvasObjectFaceCtx`](CanvasObjectFaceCtx.md)

#### Returns

`void`

***

### shortcutKey?

```ts
optional shortcutKey?: string;
```

A single A-Z key that arms the tool.

***

### source?

```ts
optional source?: "board-local" | "url" | "file";
```

Where a placed object's artifact lives. Ignored by an ephemeral
tool, which places nothing.

***

### sticky?

```ts
optional sticky?: boolean;
```

Whether the tool stays armed after a completed drag.

***

### styleFields?

```ts
optional styleFields?: readonly CanvasStyleFieldDecl[];
```
