[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginThemeSubscribe

# Type Alias: PluginThemeSubscribe

```ts
type PluginThemeSubscribe = (cb) => () => void;
```

PluginThemeSubscribe registers cb for every later appearance
change and returns the unsubscribe.

## Parameters

### cb

(`theme`) => `void`

## Returns

() => `void`
