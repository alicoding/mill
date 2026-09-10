[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginContextAPI

# Interface: PluginContextAPI

## Properties

### set

```ts
set: (key, value) => void;
```

Sets one of THIS plugin's own context keys, read back by command
`enablement` or menu `when` as `plugin.<key>` (never a fully
qualified key: writing under another plugin's namespace is not
possible through this door). Fires no host action itself. A
declarative expression reads the new value when next evaluated.

#### Parameters

##### key

`string`

##### value

[`PluginContextValue`](../type-aliases/PluginContextValue.md)

#### Returns

`void`
