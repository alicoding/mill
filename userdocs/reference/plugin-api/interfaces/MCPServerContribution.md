[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / MCPServerContribution

# Interface: MCPServerContribution

One MCP server declared in the manifest under contributes.mcpServers.

## Properties

### args?

```ts
optional args?: string[];
```

Its arguments, in order.

***

### command

```ts
command: string;
```

The program that starts the server ("npx", "uvx", "node").

***

### env?

```ts
optional env?: Record<string, string>;
```

Environment for the server process: a literal value, or
"secretRef:<setting key>" naming one of your secretRef settings.
Keys are variable names (letters, digits, underscore).

***

### id

```ts
id: string;
```

A slug unique within this plugin ("reference", "github").

***

### label

```ts
label: string;
```

The name the entity is created with; sentence case.
