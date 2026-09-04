[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFetchInit

# Interface: PluginFetchInit

The request api.fetch sends. A plugin never opens a connection
itself -- api.fetch asks Mill, whose rules allow, park for approval,
or deny the request; on approval Mill performs it and hands back the
response. A host or method the manifest's contributes.network does
not declare, or a non-http(s) URL, rejects the promise before any
rule runs.

## Properties

### body?

```ts
optional body?: string;
```

***

### headers?

```ts
optional headers?: Record<string, string>;
```

***

### method?

```ts
optional method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
```

***

### secret?

```ts
optional secret?: object;
```

Attaches a vault entry the user picked in one of this plugin's
secretRef settings: Mill resolves it after the request is
approved, sends it as `header` (default Authorization) with
`prefix` (default "Bearer "), and redacts the value from the
response you receive. The value itself never reaches plugin
code.

#### header?

```ts
optional header?: string;
```

#### prefix?

```ts
optional prefix?: string;
```

#### settingKey

```ts
settingKey: string;
```
