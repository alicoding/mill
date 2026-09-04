[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginEventMap

# Interface: PluginEventMap

PluginEventMap (goal 0278): the events a plugin can subscribe to.
'contents:changed' fires whenever anything on the board is created,
edited, moved, or deleted, with the changed entry's id. A closed
map, so a new event is a type addition here, never a convention.

## Properties

### contents:changed

```ts
contents:changed: object;
```

#### id

```ts
id: string;
```
