[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasObjectDecl

# Interface: CanvasObjectDecl

ObjectSource/EditRoute restated here as plain strings rather than
imported from atlas/objectSeams.ts: the SDK's compile-time
independence from the kernel is the point of this file, and the
host's registration path (hostApi.ts) narrows/validates them against
the kernel's own unions at registration time.

## Properties

### defaultPayload?

```ts
optional defaultPayload?: Record<string, string>;
```

Payload a fresh placement starts with.

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

dragBand (goal 0252 S2): whether the placed object needs the
shared chrome band as its drag surface (default true). Declare
false when the object's whole body already drags -- content that
doesn't capture pointer events itself.

***

### editRoute

```ts
editRoute: 
  | CanvasEditRoute
  | ((object) => CanvasEditRoute);
```

Which door edits it: 'inline' (the face itself is the editor) |
'external-app' | 'none' -- one static route, or a resolver called
per object when the door depends on the object's own artifact
(goal 0310: a file-backed kind whose editor exists for some
extensions and not others).

***

### gesture?

```ts
optional gesture?: CanvasGestureDecl;
```

The drag behavior for a 'drag-to-draw' / 'ephemeral-drag'
interaction. Required there, forbidden for 'arm-then-click'.

***

### group?

```ts
optional group?: "knowledge" | "file" | "annotate";
```

group (goal 0252 S2): which tray cluster the button renders in --
'knowledge' (default for board-local/url tools), 'file' (default
for file-backed tools), or 'annotate' (the collapsed freehand-
marking drawer).

***

### icon

```ts
icon: string;
```

icon is one emoji, or the name of a glyph from Mill's named icon
set (goal 0252 S2 -- 'pencil', 'zap', 'trash', 'diamond',
'square', 'circle', 'arrow-up-right') so a no-build plugin gets a
real toolbar icon; an unrecognized name is a registration error
naming the known set.

***

### interaction?

```ts
optional interaction?: "arm-then-click" | "drag-to-draw" | "ephemeral-drag";
```

The authoring gesture (goal 0252 S1). 'arm-then-click' (the
default): the armed click places one object with defaultPayload.
'drag-to-draw': the armed pointer drag feeds `gesture`, whose own
onEnd decides what to create. 'ephemeral-drag': the drag renders
only the live preview and never creates anything (a laser-pointer
shape) -- renderFace, source, and editRoute are unused there.

***

### kind

```ts
kind: string;
```

kind is the tool's tray/palette id and, unless objectKind says
otherwise, the persisted BoardObject.Kind -- lowercase slug, must
be unique against built-ins and other plugins.

***

### label

```ts
label: string;
```

label/description are user-facing (tray tooltip, the Extensions
row).

***

### lockable?

```ts
optional lockable?: boolean;
```

lockable (goal 0252 S2): for a NON-sticky drag tool only --
re-clicking the armed button locks it for deliberate repetition
instead of disarming (the discrete-shape convention).

***

### menuItems?

```ts
optional menuItems?: readonly CanvasObjectMenuItem[];
```

menuItems (goal 0280): this object kind's own context-menu items,
rendered on the right-click menu of the plugin's OWN objects only,
between the built-in items and Delete. Object-scoped by nature
(they act on the object that was right-clicked), so they carry a
handler rather than a registry command: run receives the same ctx
renderFace does. An item whose enabled predicate answers false is
left out of the menu entirely, never shown dimmed.

***

### objectKind?

```ts
optional objectKind?: string;
```

objectKind (goal 0252 S2): the persisted BoardObject.Kind this
tool's placements carry, when it differs from the tool id (the
same id-vs-Kind split built-in tools always had -- a pencil tool
placing 'ink' objects). Defaults to `kind`; must be unique among
registered object kinds like any other.

***

### renderFace?

```ts
optional renderFace?: (el, ctx) => void;
```

renderFace draws the object's board face into el (a host-owned
div, already sized to the object's box). Called on mount and again
whenever the object's data changes -- el's contents are the
plugin's own to manage between calls (checking ctx.object for
what changed). Framework-agnostic on purpose: plain DOM, no
renderer library coupling, no build step required of a plugin.
Optional ONLY for 'ephemeral-drag' (nothing is ever placed).

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

shortcutKey (goal 0252 S2): a single A-Z key that arms this tool
on the board (shown as the tray button's key chip). A key already
taken by another tool is a registration error.

***

### source

```ts
source: "file" | "board-local" | "url";
```

Where the object's artifact lives (ADR-0046 vocabulary):
'board-local' | 'url' | 'file'.

***

### sticky?

```ts
optional sticky?: boolean;
```

Does the tool stay armed after a completed drag (repeated strokes
are the point), or disarm after one? Only meaningful for a drag
interaction; defaults to true there (the drawing-tool convention).

***

### styleFields?

```ts
optional styleFields?: readonly CanvasStyleFieldDecl[];
```

The tool's styleable properties, from Mill's closed style
vocabulary. Declaring any makes the style picker render next to
the armed tool automatically; current values arrive on the
gesture ctx keyed by each field's own `key`, starting at its
`default`.
