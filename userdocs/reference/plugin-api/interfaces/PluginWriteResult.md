[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginWriteResult

# Interface: PluginWriteResult

The outcome of a guarded write through api.content: a denied write
resolves with approved: false and the rule's label; an approved one
carries the created (or updated) entity's id.

## Properties

### approved

```ts
approved: boolean;
```

***

### effect

```ts
effect: string;
```

***

### id

```ts
id: string;
```

***

### ruleLabel

```ts
ruleLabel: string;
```
