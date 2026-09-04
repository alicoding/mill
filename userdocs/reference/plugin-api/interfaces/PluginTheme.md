[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginTheme

# Interface: PluginTheme

The resolved light/dark appearance a face, view, or capture is
rendering under. The same mode/scheme pair is set as
data-mill-theme/data-mill-scheme on the element you are drawing
into, so plain CSS can branch on it without reading this object.

## Properties

### mode

```ts
mode: "light" | "dark";
```

The settled light/dark answer — never "auto".

***

### scheme

```ts
scheme: string;
```

The exact color scheme in effect, e.g. "dark_dimmed".
