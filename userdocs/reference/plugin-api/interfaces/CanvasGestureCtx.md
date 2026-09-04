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

Creates one instance of THIS plugin's object at a board position,
participating in undo exactly like a click placement. opts.size
sets the placed object's persisted size in board units; opts.select
selects it right after placement.

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

eraseHitTest/commitErase are present ONLY when the plugin's
manifest declares the "erase-board-items" capability.
eraseHitTest accumulates whatever board item sits under the point
(top-level items only, never a container's children);
commitErase erases the whole accumulated set through the same
undoable delete a person's own Delete key uses, as one undo step.

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

The ids of the board's top-level cards, notes and objects whose
CENTER falls inside a board-space rect -- the same enclosure rule
Mill's own Area tool uses.

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

Saves bytes into Mill's own file store and resolves with the
stored file's path, ready to use as a file-backed object's payload
(draw, save as SVG, place with the returned path is the shape of
a drawing tool). base64 is the file's content; ext is a lowercase
".ext".

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

Converts a gesture point's client position into board coordinates.

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
field's own `key`, falling back to that field's default.
