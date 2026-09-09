[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasToolCtx

# Interface: CanvasToolCtx

What a tool's own code may ask Mill to do.

## Properties

### commitErase?

```ts
optional commitErase?: () => Promise<void>;
```

#### Returns

`Promise`\<`void`\>

***

### createDraft

```ts
createDraft: (input) => Promise<CanvasDraft>;
```

Starts a draft: nothing is on the board yet, and Mill draws the
declared preview from it until it is committed or discarded.

#### Parameters

##### input

###### at

\{
  `x`: `number`;
  `y`: `number`;
\}

###### at.x

`number`

###### at.y

`number`

###### data?

`Record`\<`string`, `string`\>

###### preview?

`Record`\<`string`, `string`\>

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

`Promise`\<[`CanvasDraft`](CanvasDraft.md)\>

***

### eraseAt?

```ts
optional eraseAt?: (at) => Promise<void>;
```

Erases whatever board item sits under a board point, and commits
the whole pass as one undo step. Present only when the manifest
declares the "erase-board-items" capability.

#### Parameters

##### at

###### x

`number`

###### y

`number`

#### Returns

`Promise`\<`void`\>

***

### styleValues

```ts
styleValues: Record<string, string | number>;
```

The tool's current style-picker values, keyed by each declared
field's own `key`.
