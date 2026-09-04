[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginTheme

# Interface: PluginTheme

PluginTheme -- the resolved appearance a face, view or capture is
rendering under. The same pair rides the mount root as
data-mill-theme/data-mill-scheme, so plain CSS can branch on it
without reading this.

## Properties

### mode

```ts
mode: "light" | "dark";
```

The settled light/dark answer -- never "auto".

***

### scheme

```ts
scheme: string;
```

The exact color scheme, e.g. "dark_dimmed".
