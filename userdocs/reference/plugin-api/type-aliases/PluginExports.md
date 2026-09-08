[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginExports

# Type Alias: PluginExports

```ts
type PluginExports = Record<string, unknown> | void;
```

A plugin's activate() may return a plain object — its EXPORT
surface, captured by the loader and reachable by a declared
dependant through api.extensions.get(id).
