[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFileEntry

# Interface: PluginFileEntry

PluginFilesAPI (goal 0310): list a folder on this machine through
Mill under the "list-files" capability -- a read-class action a rule
may deny or park; entries arrive only when approved. Hidden entries
and dependency folders never appear.

## Properties

### isDir

```ts
isDir: boolean;
```

***

### name

```ts
name: string;
```

***

### path

```ts
path: string;
```

***

### size

```ts
size: number;
```
