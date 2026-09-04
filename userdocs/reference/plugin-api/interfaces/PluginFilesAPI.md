[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFilesAPI

# Interface: PluginFilesAPI

Lists a folder on this machine through Mill, under the "list-files"
capability -- a read action a rule may deny or park for approval;
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
