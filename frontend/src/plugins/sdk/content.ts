// The board's contents, read and written through Mill's own guarded
// doors: api.query lists what is already there, api.on subscribes to
// later changes, api.fetch performs a guarded network request, and
// api.content/api.files reach the board and the filesystem the same
// way an agent's own writes do.

/** One thing on the board, as api.query lists it — a card (kind
 * 'card', subkind names its own kind of card), a note (kind 'note',
 * payload.text holds its text), or a board object (its own kind, its
 * own payload). title is the name a person sees: a card's title, a
 * note's first line, an object's payload title or kind.
 *
 * `fields` — a card's own typed field values (kind 'card' only);
 * the schema they read against stays with the kind, from api.kinds.
 * `kindId` — a card's own kind id (kind 'card' only), repeating
 * subkind. */
export interface ContentEntry {
  id: string
  kind: string
  subkind?: string
  title: string
  parentId?: string
  position: { x: number; y: number }
  size?: { w: number; h: number }
  fields?: Record<string, string>
  kindId?: string
  payload: Record<string, string>
}

export interface ContentQuery {
  /** Narrows to 'card', 'note', or one object kind; omitted lists
   * everything. */
  kind?: string
  /** Narrows to one card's direct children. */
  parentId?: string
}

/** One firing of the entity/object lifecycle family:
 * `event` names which of the six transitions fired
 * ('entity.created' | 'entity.referenced' | 'entity.dereferenced' |
 * 'entity.deleted' | 'object.created' | 'object.deleted'). Every other
 * field is populated only by the event that carries it: entityKind/
 * entityId on every 'entity.*' event; by on 'entity.referenced'/
 * 'entity.dereferenced' (which board object added or removed the
 * reference); remaining on 'entity.dereferenced' only (how many
 * references survive it — 0 means nothing does anymore); boardId/
 * objectId on every 'object.*' event; kind and entityRef on
 * 'object.created' only (the object's own kind, and the Configure
 * entity kind it references, when it declares one). Ids and kinds
 * only, never the entity's own content — query for that. */
export interface LifecycleEventPayload {
  event: 'entity.created' | 'entity.referenced' | 'entity.dereferenced' | 'entity.deleted' | 'object.created' | 'object.deleted'
  entityKind?: string
  entityId?: string
  by?: { boardId?: string; objectId?: string; workflowId?: string }
  remaining?: number
  boardId?: string
  objectId?: string
  kind?: string
  entityRef?: string
}

/** The events a plugin can subscribe to through api.on.
 * 'contents:changed' fires whenever anything on the board is created,
 * edited, moved, or deleted, carrying the changed entry's id.
 * 'entity.*' fires on every entity.created/referenced/dereferenced/
 * deleted; 'object.*' fires on every object.created/deleted — a
 * filter's `kinds` narrows 'entity.*' by entityKind ('list', say) and
 * 'object.*' by the object's own kind ('table', say). A closed map: a
 * new event arrives here as a type addition, never a loose
 * convention. */
export interface PluginEventMap {
  /** kind names WHICH family changed — 'card', 'note', a board
   * object's own kind, etc. — so a filtered subscriber does not
   * re-query on changes it ignores. Undefined when Mill could not
   * say. */
  'contents:changed': { id: string; kind?: string }
  'entity.*': LifecycleEventPayload
  'object.*': LifecycleEventPayload
}

/** One field of a card kind's own schema, as api.kinds lists it. */
export interface KindFieldInfo { key: string; label: string; type: string; options?: string[] }

/** One kind of card, as api.kinds lists it: the schema a card's
 * own `fields` values read against. */
export interface KindInfo { id: string; label: string; icon?: string; fields: KindFieldInfo[] }

/** The request api.fetch sends. A plugin never opens a connection
 * itself — api.fetch asks Mill, whose rules allow, park for approval,
 * or deny the request; on approval Mill performs it and hands back the
 * response. A host or method the manifest's contributes.network does
 * not declare, or a non-http(s) URL, rejects the promise before any
 * rule runs. */
export interface PluginFetchInit {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  /** Attaches a vault entry the user picked in one of this plugin's
   * secretRef settings: Mill resolves it after the request is
   * approved, sends it as `header` (default Authorization) with
   * `prefix` (default "Bearer "), and redacts the value from the
   * response you receive. The value itself never reaches plugin
   * code. */
  secret?: { settingKey: string; header?: string; prefix?: string }
}

export interface PluginFetchResult {
  approved: boolean
  effect: string
  ruleLabel: string
  status: number
  headers: Record<string, string>
  body: string
}

/** api.fetchJSON's answer: never throws, not for a denied request, a
 * non-2xx status, or a body that isn't JSON. Check ok before reading
 * data; it carries the same non-throwing contract PluginFetchResult
 * itself does. errorText names what went wrong when ok is false: the
 * rule that denied the request, the status, or that the body wasn't
 * valid JSON. */
export interface PluginFetchJSONResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  errorText?: string
}

/** The outcome of a guarded write through api.content: a denied write
 * resolves with approved: false and the rule's label; an approved one
 * carries the created (or updated) entity's id. */
export interface PluginWriteResult {
  approved: boolean
  effect: string
  ruleLabel: string
  id: string
}

/** Writes to the board through the same guarded door an agent's own
 * writes take — create a note, a card, update a card, append a row to
 * a list — each evaluated by the person's own guardrail rules (allow,
 * park for approval, or deny) with the plugin named as the source, and
 * recorded under the plugin's own place in undo history. Needs the
 * "write-content" capability; without it every call rejects before any
 * rule runs. */
export interface PluginContentAPI {
  /** position defaults to just right of the parent's right-most item. */
  createNote: (input: { text: string; parentId?: string; position?: { x: number; y: number } }) => Promise<PluginWriteResult>
  createCard: (input: { kindId: string; title: string; note?: string; fields?: Record<string, string>; parentId?: string }) => Promise<PluginWriteResult>
  /** An empty title/note leaves that part unchanged. */
  updateCard: (id: string, patch: { title?: string; note?: string; fields?: Record<string, string> }) => Promise<PluginWriteResult>
  appendListRow: (listId: string, values: Record<string, string>) => Promise<PluginWriteResult>
  /** Creates a shared list: columns by display name with an optional
   * type (text | number | integer | boolean | date | datetime; text
   * when omitted) and optional first rows keyed by column name.
   * Resolves with the new list's id. */
  createList: (input: { title: string; description?: string; columns: { name: string; type?: string }[]; rows?: Record<string, string>[] }) => Promise<PluginWriteResult>
  /** Merge-writes named field values onto one card: keys already on
   * the card survive, keys you name take the new value, and a value
   * of '' clears its key. When the card's kind has not declared a
   * written key yet, Mill declares it on the kind first (additive
   * only). Needs the "edit-card-fields" capability; evaluated as the
   * guarded action kind card.set-fields and recorded under the
   * plugin's own place in undo history. */
  setCardFields: (cardId: string, fields: Record<string, string>) => Promise<PluginWriteResult>
}

/** One entry api.files.list returns. */
export interface PluginFileEntry { name: string; path: string; isDir: boolean; size: number }
export interface PluginListDirResult { approved: boolean; effect: string; ruleLabel: string; entries: PluginFileEntry[] }

/** Lists a folder on this machine through Mill, under the "list-files"
 * capability — a read action a rule may deny or park for approval;
 * entries arrive only once approved. Hidden entries and dependency
 * folders are never included. */
export interface PluginFilesAPI {
  list: (path: string) => Promise<PluginListDirResult>
}

/** Pure transforms Mill already implements, offered to a plugin as-is.
 * htmlToMarkdown is the exact conversion every paste and every
 * workflow convert step uses; markdownToHtml is its reverse, the same
 * sanitized renderer a mirrored file's markdown preview uses. No
 * capability required — a transform reaches nothing outside the input
 * you pass it. */
export interface PluginConvertAPI {
  htmlToMarkdown: (html: string) => Promise<string>
  markdownToHtml: (markdown: string) => Promise<string>
}
