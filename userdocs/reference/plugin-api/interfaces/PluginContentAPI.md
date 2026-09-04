[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginContentAPI

# Interface: PluginContentAPI

Writes to the board through the same guarded door an agent's own
writes take -- create a note, a card, update a card, append a row to
a list -- each evaluated by the person's own guardrail rules (allow,
park for approval, or deny) with the plugin named as the source, and
recorded under the plugin's own place in undo history. Needs the
"write-content" capability; without it every call rejects before any
rule runs.

## Properties

### appendListRow

```ts
appendListRow: (listId, values) => Promise<PluginWriteResult>;
```

#### Parameters

##### listId

`string`

##### values

`Record`\<`string`, `string`\>

#### Returns

`Promise`\<[`PluginWriteResult`](PluginWriteResult.md)\>

***

### createCard

```ts
createCard: (input) => Promise<PluginWriteResult>;
```

#### Parameters

##### input

###### fields?

`Record`\<`string`, `string`\>

###### kindId

`string`

###### note?

`string`

###### parentId?

`string`

###### title

`string`

#### Returns

`Promise`\<[`PluginWriteResult`](PluginWriteResult.md)\>

***

### createList

```ts
createList: (input) => Promise<PluginWriteResult>;
```

Creates a shared list: columns by display name with an optional
type (text | number | integer | boolean | date | datetime; text
when omitted) and optional first rows keyed by column name.
Resolves with the new list's id.

#### Parameters

##### input

###### columns

`object`[]

###### description?

`string`

###### rows?

`Record`\<`string`, `string`\>[]

###### title

`string`

#### Returns

`Promise`\<[`PluginWriteResult`](PluginWriteResult.md)\>

***

### createNote

```ts
createNote: (input) => Promise<PluginWriteResult>;
```

position defaults to just right of the parent's right-most item.

#### Parameters

##### input

###### parentId?

`string`

###### position?

\{
  `x`: `number`;
  `y`: `number`;
\}

###### position.x

`number`

###### position.y

`number`

###### text

`string`

#### Returns

`Promise`\<[`PluginWriteResult`](PluginWriteResult.md)\>

***

### updateCard

```ts
updateCard: (id, patch) => Promise<PluginWriteResult>;
```

An empty title/note leaves that part unchanged.

#### Parameters

##### id

`string`

##### patch

###### fields?

`Record`\<`string`, `string`\>

###### note?

`string`

###### title?

`string`

#### Returns

`Promise`\<[`PluginWriteResult`](PluginWriteResult.md)\>
