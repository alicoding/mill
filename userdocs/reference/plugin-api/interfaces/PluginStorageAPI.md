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

### keys

```ts
keys: () => string[];
```

#### Returns

`string`[]

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
