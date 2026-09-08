[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginElAttrs

# Type Alias: PluginElAttrs

```ts
type PluginElAttrs = Record<string, 
  | string
  | number
  | boolean
  | ((event) => void)
  | Record<string, string>
| undefined>;
```

el's attrs bag: a string/number/boolean becomes that attribute's
value (a boolean of `false` omits the attribute entirely); an `on*`
key (`onclick`, `oninput`, …) with a function value adds that event
listener; `style` with an object value assigns onto the element's
own `style`, property by property.
