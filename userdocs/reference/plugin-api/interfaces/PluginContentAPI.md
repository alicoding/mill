[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginContentAPI

# Interface: PluginContentAPI

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

createList (goal 0310) creates a Configure List: columns by display
name with an optional type (text | number | integer | boolean |
date | datetime; text when omitted) and optional first rows keyed
by column name. Resolves with the new list's id.

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
