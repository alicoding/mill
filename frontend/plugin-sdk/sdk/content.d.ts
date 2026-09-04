/** One thing on the board, as api.query lists it -- a card (kind
 * 'card', subkind names its own kind of card), a note (kind 'note',
 * payload.text holds its text), or a board object (its own kind, its
 * own payload). title is the name a person sees: a card's title, a
 * note's first line, an object's payload title or kind. */
export interface ContentEntry {
    id: string;
    kind: string;
    subkind?: string;
    title: string;
    parentId?: string;
    position: {
        x: number;
        y: number;
    };
    size?: {
        w: number;
        h: number;
    };
    payload: Record<string, string>;
}
export interface ContentQuery {
    /** Narrows to 'card', 'note', or one object kind; omitted lists
     * everything. */
    kind?: string;
    /** Narrows to one card's direct children. */
    parentId?: string;
}
/** The events a plugin can subscribe to through api.on.
 * 'contents:changed' fires whenever anything on the board is created,
 * edited, moved, or deleted, carrying the changed entry's id. A closed
 * map: a new event arrives here as a type addition, never a loose
 * convention. */
export interface PluginEventMap {
    'contents:changed': {
        id: string;
    };
}
/** The request api.fetch sends. A plugin never opens a connection
 * itself -- api.fetch asks Mill, whose rules allow, park for approval,
 * or deny the request; on approval Mill performs it and hands back the
 * response. A host or method the manifest's contributes.network does
 * not declare, or a non-http(s) URL, rejects the promise before any
 * rule runs. */
export interface PluginFetchInit {
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    /** Attaches a vault entry the user picked in one of this plugin's
     * secretRef settings: Mill resolves it after the request is
     * approved, sends it as `header` (default Authorization) with
     * `prefix` (default "Bearer "), and redacts the value from the
     * response you receive. The value itself never reaches plugin
     * code. */
    secret?: {
        settingKey: string;
        header?: string;
        prefix?: string;
    };
}
export interface PluginFetchResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    status: number;
    headers: Record<string, string>;
    body: string;
}
/** The outcome of a guarded write through api.content: a denied write
 * resolves with approved: false and the rule's label; an approved one
 * carries the created (or updated) entity's id. */
export interface PluginWriteResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    id: string;
}
/** Writes to the board through the same guarded door an agent's own
 * writes take -- create a note, a card, update a card, append a row to
 * a list -- each evaluated by the person's own guardrail rules (allow,
 * park for approval, or deny) with the plugin named as the source, and
 * recorded under the plugin's own place in undo history. Needs the
 * "write-content" capability; without it every call rejects before any
 * rule runs. */
export interface PluginContentAPI {
    /** position defaults to just right of the parent's right-most item. */
    createNote: (input: {
        text: string;
        parentId?: string;
        position?: {
            x: number;
            y: number;
        };
    }) => Promise<PluginWriteResult>;
    createCard: (input: {
        kindId: string;
        title: string;
        note?: string;
        fields?: Record<string, string>;
        parentId?: string;
    }) => Promise<PluginWriteResult>;
    /** An empty title/note leaves that part unchanged. */
    updateCard: (id: string, patch: {
        title?: string;
        note?: string;
        fields?: Record<string, string>;
    }) => Promise<PluginWriteResult>;
    appendListRow: (listId: string, values: Record<string, string>) => Promise<PluginWriteResult>;
    /** Creates a shared list: columns by display name with an optional
     * type (text | number | integer | boolean | date | datetime; text
     * when omitted) and optional first rows keyed by column name.
     * Resolves with the new list's id. */
    createList: (input: {
        title: string;
        description?: string;
        columns: {
            name: string;
            type?: string;
        }[];
        rows?: Record<string, string>[];
    }) => Promise<PluginWriteResult>;
}
/** One entry api.files.list returns. */
export interface PluginFileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
}
export interface PluginListDirResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    entries: PluginFileEntry[];
}
/** Lists a folder on this machine through Mill, under the "list-files"
 * capability -- a read action a rule may deny or park for approval;
 * entries arrive only once approved. Hidden entries and dependency
 * folders are never included. */
export interface PluginFilesAPI {
    list: (path: string) => Promise<PluginListDirResult>;
}
/** Pure transforms Mill already implements, offered to a plugin as-is.
 * htmlToMarkdown is the exact conversion every paste and every
 * workflow convert step uses. No capability required -- a transform
 * reaches nothing outside the input you pass it. */
export interface PluginConvertAPI {
    htmlToMarkdown: (html: string) => Promise<string>;
}
