[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / ContentEntry

# Interface: ContentEntry

One thing on the board, as api.query lists it — a card (kind
'card', subkind names its own kind of card), a note (kind 'note',
payload.text holds its text), or a board object (its own kind, its
own payload). title is the name a person sees: a card's title, a
note's first line, an object's payload title or kind.

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

### parentId?

```ts
optional parentId?: string;
```

***

### payload

```ts
payload: Record<string, string>;
```

***

### position

```ts
position: object;
```

#### x

```ts
x: number;
```

#### y

```ts
y: number;
```

***

### size?

```ts
optional size?: object;
```

#### h

```ts
h: number;
```

#### w

```ts
w: number;
```

***

### subkind?

```ts
optional subkind?: string;
```

***

### title

```ts
title: string;
```
