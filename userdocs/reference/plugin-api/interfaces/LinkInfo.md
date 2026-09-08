[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / LinkInfo

# Interface: LinkInfo

One typed relation between two cards, as api.links lists it —
read-only and directional: source is the card the relation was
drawn from, target the other end, kind the relation's own type
(its id, matching an entry from api.linkKinds).

## Properties

### id

```ts
id: string;
```

***

### kind

```ts
kind: string;
```

***

### source

```ts
source: string;
```

***

### target

```ts
target: string;
```
