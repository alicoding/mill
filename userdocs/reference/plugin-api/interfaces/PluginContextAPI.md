[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginContextAPI

# Interface: PluginContextAPI

## Properties

### set

```ts
set: (key, value) => void;
```

Sets one of THIS plugin's own context keys, read back by any
declared item's `when` clause as `plugin.<key>` (never a fully
qualified key: writing under another plugin's namespace is not
possible through this door). Fires no host action itself. A
`when` referencing the key reads the new value the next time it
is evaluated.

#### Parameters

##### key

`string`

##### value

[`PluginContextValue`](../type-aliases/PluginContextValue.md)

#### Returns

`void`
