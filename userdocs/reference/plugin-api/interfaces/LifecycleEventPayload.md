[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / LifecycleEventPayload

# Interface: LifecycleEventPayload

One firing of the entity/object lifecycle family:
`event` names which of the six transitions fired
('entity.created' | 'entity.referenced' | 'entity.dereferenced' |
'entity.deleted' | 'object.created' | 'object.deleted'). Every other
field is populated only by the event that carries it: entityKind/
entityId on every 'entity.*' event; by on 'entity.referenced'/
'entity.dereferenced' (which board object added or removed the
reference); remaining on 'entity.dereferenced' only (how many
references survive it — 0 means nothing does anymore); boardId/
objectId on every 'object.*' event; kind and entityRef on
'object.created' only (the object's own kind, and the Configure
entity kind it references, when it declares one). Ids and kinds
only, never the entity's own content — query for that.

## Properties

### boardId?

```ts
optional boardId?: string;
```

***

### by?

```ts
optional by?: object;
```

#### boardId?

```ts
optional boardId?: string;
```

#### objectId?

```ts
optional objectId?: string;
```

#### workflowId?

```ts
optional workflowId?: string;
```

***

### entityId?

```ts
optional entityId?: string;
```

***

### entityKind?

```ts
optional entityKind?: string;
```

***

### entityRef?

```ts
optional entityRef?: string;
```

***

### event

```ts
event: 
  | "entity.created"
  | "entity.referenced"
  | "entity.dereferenced"
  | "entity.deleted"
  | "object.created"
  | "object.deleted";
```

***

### kind?

```ts
optional kind?: string;
```

***

### objectId?

```ts
optional objectId?: string;
```

***

### remaining?

```ts
optional remaining?: number;
```
