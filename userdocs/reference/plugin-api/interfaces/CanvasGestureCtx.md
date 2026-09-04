[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasGestureCtx

# Interface: CanvasGestureCtx

## Properties

### commitErase?

```ts
optional commitErase?: () => void;
```

#### Returns

`void`

***

### createObject

```ts
createObject: (payload, flowPos, opts?) => Promise<void>;
```

Creates one instance of THIS plugin's object at a board position
-- files into the frame under the point, syncs, and participates
in undo exactly like a click placement. opts.size sets the
placed object's persisted size in board units; opts.select
selects it after placement (the discrete-shape convention).

#### Parameters

##### payload

`Record`\<`string`, `string`\>

##### flowPos

###### x

`number`

###### y

`number`

##### opts?

###### select?

`boolean`

###### size?

\{
  `h`: `number`;
  `w`: `number`;
\}

###### size.h

`number`

###### size.w

`number`

#### Returns

`Promise`\<`void`\>

***

### eraseHitTest?

```ts
optional eraseHitTest?: (pt) => void;
```

The erase door (goal 0252 S2), present ONLY when the plugin's
manifest declares the "erase-board-items" capability. eraseHitTest
accumulates whatever board item sits under the point (top-level
leaves only -- containers are never swept); commitErase erases the
whole accumulated set through the same undoable quick-delete door
a user's own Delete key uses, one undo step per pass. Item
identities stay host-side throughout.

#### Parameters

##### pt

###### x

`number`

###### y

`number`

#### Returns

`void`

***

### itemsInRect

```ts
itemsInRect: (rect) => CanvasItemsInRect;
```

The spatial-query door (goal 0310): the ids of the board's top-
level cards, notes and objects whose CENTER falls inside a board-
space rect -- the same enclosure rule the built-in Area tool uses.

#### Parameters

##### rect

[`CanvasRect`](CanvasRect.md)

#### Returns

[`CanvasItemsInRect`](CanvasItemsInRect.md)

***

### saveImageBytes

```ts
saveImageBytes: (base64, ext, title) => Promise<string>;
```

Bakes bytes into Mill's own mirror store and returns the stored
file's path for a file-backed object's payload (goal 0252 S2 --
the pencil convention: draw, bake to SVG, place with mirrorPath).
base64 is the file's content; ext is a lowercase ".ext".

#### Parameters

##### base64

`string`

##### ext

`string`

##### title

`string`

#### Returns

`Promise`\<`string`\>

***

### screenToFlowPosition

```ts
screenToFlowPosition: (p) => object;
```

Converts a gesture point's client position into board (flow)
coordinates.

#### Parameters

##### p

###### x

`number`

###### y

`number`

#### Returns

`object`

##### x

```ts
x: number;
```

##### y

```ts
y: number;
```

***

### styleValues

```ts
styleValues: Record<string, string | number>;
```

The tool's current style-picker values, keyed by each declared
field's own `key`, falling back to each field's default.
