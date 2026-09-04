[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginStorageAPI

# Interface: PluginStorageAPI

PluginStorageAPI (goal 0277): the plugin's own key-value store,
persisted centrally under the plugin id -- VS Code's globalState /
Obsidian's saveData shape. Values are any JSON-serialisable value
(a non-serialisable one throws at the door). get/keys are
synchronous over a cache loaded before activate(); set/delete
persist through the host and resolve when written. Storage is
plugin-private: nothing else in Mill reads it.

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

#### Parameters

##### key

`string`

##### value

`unknown`

#### Returns

`Promise`\<`void`\>
