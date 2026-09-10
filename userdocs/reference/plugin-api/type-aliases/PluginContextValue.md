[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginContextValue

# Type Alias: PluginContextValue

```ts
type PluginContextValue = 
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];
```

A context value is null, a string, a finite number, a boolean, or
a flat array containing those scalar values. Arrays are copied when
accepted. Objects, nested arrays and non-finite numbers are refused.
