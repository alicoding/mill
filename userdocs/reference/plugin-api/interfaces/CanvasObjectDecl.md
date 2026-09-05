[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasObjectDecl

# Interface: CanvasObjectDecl

## Properties

### content?

```ts
optional content?: "static" | "interactive";
```

content: what happens to input over the object's face.
'static' (the default) means the canvas owns every gesture over it
— the face is a picture. 'interactive' means the face scrolls,
selects text, or edits in place, so the object goes through three
states: idle (a click shield takes the first click, and the canvas
keeps the wheel, the drag and the keys), selected (the face
receives pointer events and keys, and a wheel over anything in it
that really scrolls stays inside it), and editing (the face has an
editor open and the board's shortcuts stand down). Declare
'interactive' before calling ctx.setEditing.

***

### defaultPayload?

```ts
optional defaultPayload?: Record<string, string>;
```

The payload a fresh placement starts with.

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

dragBand: whether a placed object needs the shared chrome band as
its drag surface (default true). Set false when the object's whole
body already captures pointer events for dragging on its own.

***

### editRoute

```ts
editRoute: 
  | CanvasEditRoute
  | ((object) => CanvasEditRoute);
```

Which door edits the object: 'inline' (the face itself is the
editor), 'external-app', or 'none' — one fixed value, or a
resolver called per object when the answer depends on that
object's own data (some file extensions are editable in place and
some are not, say).

***

### gesture?

```ts
optional gesture?: CanvasGestureDecl;
```

The drag behavior for a 'drag-to-draw' or 'ephemeral-drag'
interaction. Required there, and not accepted for
'arm-then-click'.

***

### group?

```ts
optional group?: "knowledge" | "file" | "annotate";
```

group: which tray cluster the button renders in — 'knowledge'
(default for board-local or url-backed tools), 'file' (default for
file-backed tools), or 'annotate' (the collapsed freehand-marking
drawer).

***

### icon

```ts
icon: string;
```

icon is one emoji, or the name of a glyph from Mill's named icon
set ('pencil', 'zap', 'trash', 'diamond', 'square', 'circle',
'arrow-up-right') so the tool gets a real toolbar icon with no
image asset required. An unrecognized name fails registration,
naming the known set.

***

### interaction?

```ts
optional interaction?: "arm-then-click" | "drag-to-draw" | "ephemeral-drag";
```

The authoring gesture. 'arm-then-click' (the default): the armed
click places one object with defaultPayload. 'drag-to-draw': the
armed pointer drag feeds `gesture`, whose own onEnd decides what to
create. 'ephemeral-drag': the drag renders only a live preview and
never creates anything (a laser pointer); source, editRoute and
renderFace go unused for it.

***

### kind

```ts
kind: string;
```

kind is the tool's tray/palette id and, unless objectKind says
otherwise, the kind every placed instance is stored under --
lowercase slug, must be unique against Mill's own tools and every
other plugin.

***

### label

```ts
label: string;
```

label/description are user-facing: the tray tooltip and the
plugin's row in Settings.

***

### lockable?

```ts
optional lockable?: boolean;
```

lockable: for a non-sticky drag tool only — re-clicking the
armed button locks it for deliberate repeated use instead of
disarming.

***

### menuItems?

```ts
optional menuItems?: readonly CanvasObjectMenuItem[];
```

menuItems: this object kind's own context-menu items, rendered on
the right-click menu of the plugin's OWN objects only, between
Mill's built-in items and Delete. An item whose enabled predicate
returns false is left out of the menu entirely rather than shown
disabled.

***

### objectKind?

```ts
optional objectKind?: string;
```

objectKind: the stored kind this tool's placements carry, when it
differs from the tool id (useful when one tool id should place
several visually distinct kinds). Defaults to `kind`; must be
unique among every registered object kind like any other.

***

### renderFace?

```ts
optional renderFace?: (el, ctx) => void;
```

renderFace draws the object's board face into el (an element
already sized to the object's box). Called on mount and again
whenever the object's own data changes — el's contents are yours
to manage between calls. Deliberately plain DOM: no renderer
library coupling, no build step required to write a plugin.
Optional only for 'ephemeral-drag' (nothing is ever placed).

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

shortcutKey: a single A-Z key that arms this tool on the board,
shown as the tray button's key chip. A key another tool already
uses fails registration.

***

### source

```ts
source: "file" | "board-local" | "url";
```

Where the object's own artifact lives: a value only this board
knows ('board-local'), a web address ('url'), or a file on disk
('file').

***

### sticky?

```ts
optional sticky?: boolean;
```

Whether the tool stays armed after a completed drag (for repeated
strokes) or disarms after one. Only meaningful for a drag
interaction; defaults to true there.

***

### styleFields?

```ts
optional styleFields?: readonly CanvasStyleFieldDecl[];
```

The tool's styleable properties, from Mill's own closed style
vocabulary. Declaring any makes a style picker render next to the
armed tool automatically; the picker's current values arrive on
the gesture ctx keyed by each field's own `key`, starting at its
`default`.
