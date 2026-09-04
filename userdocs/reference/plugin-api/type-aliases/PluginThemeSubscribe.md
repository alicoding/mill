[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginThemeSubscribe

# Type Alias: PluginThemeSubscribe

```ts
type PluginThemeSubscribe = (cb) => () => void;
```

Subscribes cb to every later appearance change (a user switching
light/dark, or the OS following sunset) and returns the function
that unsubscribes it.

## Parameters

### cb

(`theme`) => `void`

## Returns

() => `void`
