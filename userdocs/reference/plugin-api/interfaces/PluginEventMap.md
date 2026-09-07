[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginEventMap

# Interface: PluginEventMap

The events a plugin can subscribe to through api.on.
'contents:changed' fires whenever anything on the board is created,
edited, moved, or deleted, carrying the changed entry's id. A closed
map: a new event arrives here as a type addition, never a loose
convention.

## Properties

### contents:changed

```ts
contents:changed: object;
```

kind names WHICH family changed — 'card', 'note', a board
object's own kind, etc. — so a filtered subscriber does not
re-query on changes it ignores. Undefined when Mill could not
say.

#### id

```ts
id: string;
```

#### kind?

```ts
optional kind?: string;
```
