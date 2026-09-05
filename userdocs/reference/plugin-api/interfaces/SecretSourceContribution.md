[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / SecretSourceContribution

# Interface: SecretSourceContribution

What contributes.secretSources declares for one source: the id
secrets.js registers under, the label the picker offers it as (40
characters or fewer), how its path field renders, and which of the
four functions it implements.

## Properties

### capabilities

```ts
capabilities: ("list" | "resolve" | "discover" | "import")[];
```

***

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

### path

```ts
path: object;
```

#### default?

```ts
optional default?: string;
```

#### kind

```ts
kind: SecretSourcePathKind;
```

#### label

```ts
label: string;
```

#### placeholder?

```ts
optional placeholder?: string;
```
