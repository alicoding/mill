[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginOutputOptions

# Interface: PluginOutputOptions

## Properties

### mime?

```ts
optional mime?: string;
```

The value's media type, if a response gave you one. Used when
`shape` is absent — `application/json` picks the tree, `text/html`
the rendered view, and so on.

***

### shape?

```ts
optional shape?: PluginOutputShape;
```

What the value is. Prefer declaring it: an inferred shape is a
guess, a declared one is a fact.

***

### title?

```ts
optional title?: string;
```

A short name for what this output is, used as the viewer's
accessible label and as its title when opened full.
