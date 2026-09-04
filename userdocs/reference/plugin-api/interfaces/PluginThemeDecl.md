[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginThemeDecl

# Interface: PluginThemeDecl

One color theme a plugin contributes, declared under
contributes.themes in the manifest. A theme is DATA, not code: file
names a CSS file inside your plugin folder holding nothing but
`--token: value;` declarations drawn from Mill's documented theme
variables. Mill layers it over the family's built-in palette, so you
only name the tokens you actually change. id is unique within your
plugin, and users see the theme in Settings > Appearance as label,
listed under family's picker with your plugin's name beneath it.

## Properties

### family

```ts
family: "light" | "dark";
```

***

### file

```ts
file: string;
```

***

### id

```ts
id: string;
```

***

### label

```ts
label: string;
```
