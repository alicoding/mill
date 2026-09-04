[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFetchInit

# Interface: PluginFetchInit

PluginFetchInit / PluginFetchResult (goal 0288): the network door.
A plugin never opens a connection -- api.fetch asks Mill, whose
guardrail rules allow, park in Review, or deny the request; on
approval Mill performs it host-side, confined to a host the
manifest's contributes.network declares (redirects included), and
hands the response back. A host or method the manifest does not
declare, or a non-http(s) URL, REJECTS the promise before any rule
runs; a denied or still-parked-then-denied request RESOLVES with
approved: false and the rule's label.

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

Attach a vault entry the user picked in one of this plugin's
secretRef settings (ADR-0048): Mill resolves it host-side after
the request is approved, sends it as `header` (default
Authorization) with `prefix` (default "Bearer "), and redacts the
value from the response. The value never reaches plugin code.

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
