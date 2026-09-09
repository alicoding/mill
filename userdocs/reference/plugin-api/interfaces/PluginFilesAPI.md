[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFilesAPI

# Interface: PluginFilesAPI

Lists a folder on this machine through Mill, under the "list-files"
capability — a read action a rule may deny or park for approval;
entries arrive only once approved. Hidden entries and dependency
folders are never included.

## Properties

### list

```ts
list: (path) => Promise<PluginListDirResult>;
```

#### Parameters

##### path

`string`

#### Returns

`Promise`\<[`PluginListDirResult`](PluginListDirResult.md)\>

***

### saveImageBytes

```ts
saveImageBytes: (base64, ext, title) => Promise<string>;
```

Saves bytes into Mill's own file store and resolves with the
stored file's path, ready to use as a file-backed object's
payload. base64 is the file's content; ext is a lowercase
".ext".

#### Parameters

##### base64

`string`

##### ext

`string`

##### title

`string`

#### Returns

`Promise`\<`string`\>
