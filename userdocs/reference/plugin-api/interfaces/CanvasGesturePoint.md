[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasGesturePoint

# Interface: CanvasGesturePoint

One accumulated point of an in-flight drag, in wrapper-local client
space, with its capture timestamp (only an 'ephemeral-drag' tool
needs `t`, to age points out; every other tool can ignore it).

## Properties

### t

```ts
t: number;
```

***

### x

```ts
x: number;
```

***

### y

```ts
y: number;
```
