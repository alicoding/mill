[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / ContentQuery

# Interface: ContentQuery

## Properties

### kind?

```ts
optional kind?: string;
```

kind narrows to 'card', 'note', or one object kind; omitted lists
everything.

***

### parentId?

```ts
optional parentId?: string;
```

parentId narrows to one card's direct children.
