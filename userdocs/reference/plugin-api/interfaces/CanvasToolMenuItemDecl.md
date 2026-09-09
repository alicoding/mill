[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasToolMenuItemDecl

# Interface: CanvasToolMenuItemDecl

One context-menu item on this tool's own objects. `when` decides
when it shows, over the facts Mill computes about the object and the
selection — an item that always shows says so with `when: 'true'`.

## Properties

### id

```ts
id: string;
```

***

### label

```ts
label: string;
```

***

### when

```ts
when: string;
```
