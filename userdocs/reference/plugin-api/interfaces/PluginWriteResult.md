[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginWriteResult

# Interface: PluginWriteResult

PluginContentAPI (goal 0289): writes to the board through the SAME
guarded content plane an agent's writes take -- create a note, a
card, update a card, append a List row -- each evaluated by the
owner's guardrail rules (allow / park in Review / deny) with the
plugin as the named source, and recorded under the plugin's own
undo actor. Needs the "write-content" capability; without it every
call rejects before any rule runs. A denied write resolves with
approved: false and the rule's label; an approved one carries the
created (or updated) entity's id.

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
