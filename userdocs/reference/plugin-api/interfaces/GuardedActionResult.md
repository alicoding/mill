[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / GuardedActionResult

# Interface: GuardedActionResult

The outcome of one guarded-action request. approved is false for
both a denial and a still-pending approval that was later denied;
ruleLabel names the rule that decided, when there was one;
performed is true only once Mill actually carried the action out.

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

### performed

```ts
performed: boolean;
```

***

### ruleLabel

```ts
ruleLabel: string;
```
