[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasDraft

# Interface: CanvasDraft

The draft a tool is drawing. Every write is live and undoes as
nothing — only `commit` reaches the board, as one undo step.

## Properties

### commit

```ts
commit: (opts?) => Promise<string | null>;
```

Places the draft on the board as one undoable step and resolves
with the new object's id, or null when nothing was placed.

#### Parameters

##### opts?

###### select?

`boolean`

#### Returns

`Promise`\<`string` \| `null`\>

***

### discard

```ts
discard: () => Promise<void>;
```

Throws the draft away; the board is exactly as it was.

#### Returns

`Promise`\<`void`\>

***

### id

```ts
id: string;
```

***

### patch

```ts
patch: (patch) => Promise<void>;
```

Merges data, position and size into the draft. Mill redraws the
preview from it.

#### Parameters

##### patch

###### at?

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
