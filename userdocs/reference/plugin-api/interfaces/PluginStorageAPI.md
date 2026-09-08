[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginStorageAPI

# Interface: PluginStorageAPI

## Properties

### delete

```ts
delete: (key) => Promise<void>;
```

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`void`\>

***

### get

```ts
get: (key) => unknown;
```

Synchronous: reads from a cache loaded before activate() ran.

#### Parameters

##### key

`string`

#### Returns

`unknown`

***

### getList

```ts
getList: (key) => Promise<unknown[]>;
```

Reads the array stored at key, or [] when nothing is stored there
yet or the stored value is not an array.

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`unknown`[]\>

***

### keys

```ts
keys: () => string[];
```

#### Returns

`string`[]

***

### pushList

```ts
pushList: (key, item, opts?) => Promise<void>;
```

Adds item to the front of the list stored at key (creating it
empty first). dedupeBy, when given, first removes any earlier
item it resolves to the same key as item; max, when given, then
trims the list to that many entries, oldest dropped first.

#### Parameters

##### key

`string`

##### item

`unknown`

##### opts?

###### dedupeBy?

(`item`) => `unknown`

###### max?

`number`

#### Returns

`Promise`\<`void`\>

***

### set

```ts
set: (key, value) => Promise<void>;
```

Any JSON-serialisable value; a value that is not throws at the
call. Resolves once the write is durably stored.

#### Parameters

##### key

`string`

##### value

`unknown`

#### Returns

`Promise`\<`void`\>
