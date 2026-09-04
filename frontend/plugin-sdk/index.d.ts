/** ObjectSource/EditRoute restated here as plain strings rather than
 * imported from atlas/objectSeams.ts: the SDK's compile-time
 * independence from the kernel is the point of this file, and the
 * host's registration path (hostApi.ts) narrows/validates them against
 * the kernel's own unions at registration time. */
export interface CanvasObjectDecl {
    /** kind is the tool's tray/palette id and, unless objectKind says
     * otherwise, the persisted BoardObject.Kind -- lowercase slug, must
     * be unique against built-ins and other plugins. */
    kind: string;
    /** objectKind (goal 0252 S2): the persisted BoardObject.Kind this
     * tool's placements carry, when it differs from the tool id (the
     * same id-vs-Kind split built-in tools always had -- a pencil tool
     * placing 'ink' objects). Defaults to `kind`; must be unique among
     * registered object kinds like any other. */
    objectKind?: string;
    /** label/description are user-facing (tray tooltip, the Extensions
     * row). */
    label: string;
    description?: string;
    /** icon is one emoji, or the name of a glyph from Mill's named icon
     * set (goal 0252 S2 -- 'pencil', 'zap', 'trash', 'diamond',
     * 'square', 'circle', 'arrow-up-right') so a no-build plugin gets a
     * real toolbar icon; an unrecognized name is a registration error
     * naming the known set. */
    icon: string;
    /** shortcutKey (goal 0252 S2): a single A-Z key that arms this tool
     * on the board (shown as the tray button's key chip). A key already
     * taken by another tool is a registration error. */
    shortcutKey?: string;
    /** group (goal 0252 S2): which tray cluster the button renders in --
     * 'knowledge' (default for board-local/url tools), 'file' (default
     * for file-backed tools), or 'annotate' (the collapsed freehand-
     * marking drawer). */
    group?: 'knowledge' | 'file' | 'annotate';
    /** lockable (goal 0252 S2): for a NON-sticky drag tool only --
     * re-clicking the armed button locks it for deliberate repetition
     * instead of disarming (the discrete-shape convention). */
    lockable?: boolean;
    /** dragBand (goal 0252 S2): whether the placed object needs the
     * shared chrome band as its drag surface (default true). Declare
     * false when the object's whole body already drags -- content that
     * doesn't capture pointer events itself. */
    dragBand?: boolean;
    /** Where the object's artifact lives (ADR-0046 vocabulary):
     * 'board-local' | 'url' | 'file'. */
    source: 'board-local' | 'url' | 'file';
    /** Which door edits it: 'inline' (the face itself is the editor) |
     * 'external-app' | 'none' -- one static route, or a resolver called
     * per object when the door depends on the object's own artifact
     * (goal 0310: a file-backed kind whose editor exists for some
     * extensions and not others). */
    editRoute: CanvasEditRoute | ((object: CanvasObjectRef) => CanvasEditRoute);
    /** Payload a fresh placement starts with. */
    defaultPayload?: Record<string, string>;
    /** The authoring gesture (goal 0252 S1). 'arm-then-click' (the
     * default): the armed click places one object with defaultPayload.
     * 'drag-to-draw': the armed pointer drag feeds `gesture`, whose own
     * onEnd decides what to create. 'ephemeral-drag': the drag renders
     * only the live preview and never creates anything (a laser-pointer
     * shape) -- renderFace, source, and editRoute are unused there. */
    interaction?: 'arm-then-click' | 'drag-to-draw' | 'ephemeral-drag';
    /** Does the tool stay armed after a completed drag (repeated strokes
     * are the point), or disarm after one? Only meaningful for a drag
     * interaction; defaults to true there (the drawing-tool convention). */
    sticky?: boolean;
    /** The tool's styleable properties, from Mill's closed style
     * vocabulary. Declaring any makes the style picker render next to
     * the armed tool automatically; current values arrive on the
     * gesture ctx keyed by each field's own `key`, starting at its
     * `default`. */
    styleFields?: readonly CanvasStyleFieldDecl[];
    /** The drag behavior for a 'drag-to-draw' / 'ephemeral-drag'
     * interaction. Required there, forbidden for 'arm-then-click'. */
    gesture?: CanvasGestureDecl;
    /** menuItems (goal 0280): this object kind's own context-menu items,
     * rendered on the right-click menu of the plugin's OWN objects only,
     * between the built-in items and Delete. Object-scoped by nature
     * (they act on the object that was right-clicked), so they carry a
     * handler rather than a registry command: run receives the same ctx
     * renderFace does. An item whose enabled predicate answers false is
     * left out of the menu entirely, never shown dimmed. */
    menuItems?: readonly CanvasObjectMenuItem[];
    /** renderFace draws the object's board face into el (a host-owned
     * div, already sized to the object's box). Called on mount and again
     * whenever the object's data changes -- el's contents are the
     * plugin's own to manage between calls (checking ctx.object for
     * what changed). Framework-agnostic on purpose: plain DOM, no
     * renderer library coupling, no build step required of a plugin.
     * Optional ONLY for 'ephemeral-drag' (nothing is ever placed). */
    renderFace?: (el: HTMLElement, ctx: CanvasObjectFaceCtx) => void;
}
/** Mill's closed style vocabulary (the same shapes built-in tools
 * declare) -- restated as plain data for the SDK's compile-time
 * independence; the host validates and fills the panel's own
 * accessibility/test plumbing at registration time. Each field's
 * `key` doubles as its picker's testid suffix
 * (`atlas-<toolId>-<key>-<option>`); `label` is the row's verbatim
 * accessible name (defaults to "<tool label> <key>"). 'shape-kind'
 * options name their icons from the same named glyph set
 * CanvasObjectDecl.icon accepts (goal 0252 S2). */
export type CanvasStyleFieldDecl = {
    type: 'color';
    key: string;
    label?: string;
    options: readonly string[];
    default: string;
} | {
    type: 'color-or-none';
    key: string;
    label?: string;
    options: readonly string[];
} | {
    type: 'stroke-width';
    key: string;
    label?: string;
    render?: 'line' | 'dot';
    options: readonly number[];
    default: number;
} | {
    type: 'shape-kind';
    key: string;
    label?: string;
    options: readonly {
        value: string;
        icon: string;
        label: string;
    }[];
    default: string;
};
/** One accumulated point of an in-flight drag, in wrapper-local client
 * space, with its capture timestamp (an ephemeral tool ages points out
 * by `t`; every other tool can ignore it). */
export interface CanvasGesturePoint {
    x: number;
    y: number;
    t: number;
}
/** What a gesture's own callbacks may reach -- deliberately narrow
 * (docs/goals/0252 S1): the conversion into board space, the tool's
 * own current style values, and the one creation door, scoped to this
 * plugin's own kind. Kernel internals (other objects' boxes, deletion,
 * selection) are not part of this surface. */
export type CanvasEditRoute = 'inline' | 'external-app' | 'none';
/** CanvasObjectRef: the object an edit-route resolver sees. */
export interface CanvasObjectRef {
    ID: string;
    Kind: string;
    Payload: Record<string, string>;
}
export interface CanvasRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface CanvasItemsInRect {
    cardIds: string[];
    noteIds: string[];
    objectIds: string[];
}
export interface CanvasGestureCtx {
    /** Converts a gesture point's client position into board (flow)
     * coordinates. */
    screenToFlowPosition: (p: {
        x: number;
        y: number;
    }) => {
        x: number;
        y: number;
    };
    /** The tool's current style-picker values, keyed by each declared
     * field's own `key`, falling back to each field's default. */
    styleValues: Record<string, string | number>;
    /** Creates one instance of THIS plugin's object at a board position
     * -- files into the frame under the point, syncs, and participates
     * in undo exactly like a click placement. opts.size sets the
     * placed object's persisted size in board units; opts.select
     * selects it after placement (the discrete-shape convention). */
    createObject: (payload: Record<string, string>, flowPos: {
        x: number;
        y: number;
    }, opts?: {
        size?: {
            w: number;
            h: number;
        };
        select?: boolean;
    }) => Promise<void>;
    /** Bakes bytes into Mill's own mirror store and returns the stored
     * file's path for a file-backed object's payload (goal 0252 S2 --
     * the pencil convention: draw, bake to SVG, place with mirrorPath).
     * base64 is the file's content; ext is a lowercase ".ext". */
    saveImageBytes: (base64: string, ext: string, title: string) => Promise<string>;
    /** The spatial-query door (goal 0310): the ids of the board's top-
     * level cards, notes and objects whose CENTER falls inside a board-
     * space rect -- the same enclosure rule the built-in Area tool uses. */
    itemsInRect: (rect: CanvasRect) => CanvasItemsInRect;
    /** The erase door (goal 0252 S2), present ONLY when the plugin's
     * manifest declares the "erase-board-items" capability. eraseHitTest
     * accumulates whatever board item sits under the point (top-level
     * leaves only -- containers are never swept); commitErase erases the
     * whole accumulated set through the same undoable quick-delete door
     * a user's own Delete key uses, one undo step per pass. Item
     * identities stay host-side throughout. */
    eraseHitTest?: (pt: {
        x: number;
        y: number;
    }) => void;
    commitErase?: () => void;
}
export interface CanvasGestureDecl {
    /** Called per accumulated point while the drag is live. */
    onPoint?: (pt: CanvasGesturePoint, ctx: CanvasGestureCtx) => void;
    /** Called once at pointer-up with the FULL point list -- a stray
     * click included, so deciding what counts as a real gesture (a
     * distance threshold, a point count) is the plugin's own call. */
    onEnd: (points: CanvasGesturePoint[], ctx: CanvasGestureCtx) => void;
    /** Draws the live in-drag preview into el (a host-owned overlay
     * element spanning the board) -- called on every point and, for an
     * ephemeral tool, on every fade frame. el's contents are the
     * plugin's own to manage between calls. */
    renderPreview?: (el: HTMLElement, points: CanvasGesturePoint[], now: number) => void;
    /** Ephemeral tools: accumulated points age out over this many
     * milliseconds instead of clearing at pointer-up. */
    fadeMs?: number;
}
export interface CanvasObjectMenuItem {
    id: string;
    label: string;
    run: (ctx: CanvasObjectFaceCtx) => void;
    enabled?: (ctx: CanvasObjectFaceCtx) => boolean;
}
/** PluginTheme -- the resolved appearance a face, view or capture is
 * rendering under. The same pair rides the mount root as
 * data-mill-theme/data-mill-scheme, so plain CSS can branch on it
 * without reading this. */
export interface PluginTheme {
    /** The settled light/dark answer -- never "auto". */
    mode: 'light' | 'dark';
    /** The exact color scheme, e.g. "dark_dimmed". */
    scheme: string;
}
/** PluginThemeSubscribe registers cb for every later appearance
 * change and returns the unsubscribe. */
export type PluginThemeSubscribe = (cb: (theme: PluginTheme) => void) => () => void;
export interface CanvasObjectFaceCtx {
    object: {
        ID: string;
        Kind: string;
        Payload: Record<string, string>;
        /** The object's persisted size in board units, or null until the
         * user first resizes it (the wire shape's own convention). */
        Size: {
            W: number;
            H: number;
        } | null;
    };
    /** For a file-source object: the mirrored file's current bytes as a
     * data: URL once loaded (null while loading), and whether the read
     * failed. Binary files (images, sheets, pdf) are base64 data: URLs
     * with their MIME type; text files (markdown source, json, csv,
     * .env) are text/plain data: URLs, percent-encoded. renderFace
     * re-runs when either changes. Absent for board-local and url
     * objects. */
    mirror?: {
        dataUrl: string | null;
        failed: boolean;
    };
    /** updatePayload merges patch into this object's payload through the
     * host (an empty string deletes a key). The write persists, syncs,
     * and participates in undo like any built-in edit. */
    updatePayload: (patch: Record<string, string>) => Promise<void>;
    /** requestGuardedAction asks Mill to perform an action the plugin
     * cannot perform itself. The action kind must be declared in the
     * plugin's manifest capabilities; each use is evaluated by the
     * owner's guardrail rules and may require live approval. */
    requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>;
    /** The appearance this face is rendering under. */
    theme: PluginTheme;
    /** onThemeChange registers cb for every later appearance change. */
    onThemeChange: PluginThemeSubscribe;
    /** mountOffBoard attaches el to the document OFF the board, at exactly
     * `size` CSS pixels and unscaled by the board's zoom, and returns the
     * detach. The face's own el is CSS-scaled with the canvas, so an
     * engine that measures and fits its layout from screen rectangles
     * (a mind-map or graph layout, a text-measuring chart) lays out wrong
     * in place -- render it on this stage at the face's size, copy the
     * finished drawing into el, detach. Anything still mounted when the
     * face unmounts is detached by the host. */
    mountOffBoard: (el: Element, size: {
        w: number;
        h: number;
    }) => () => void;
}
export interface GuardedActionResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    performed: boolean;
}
export interface PluginCommandDecl {
    id: string;
    label: string;
    run: () => void;
    /** enabled (goal 0258 slice 1, the same "when" clause built-in
     * commands carry): omit for an always-valid command; provide a
     * predicate when the command only makes sense in a state -- the
     * palette omits a disabled command entirely rather than showing
     * something that does nothing. Never guard inside run() and return
     * silently. A default keybinding is deliberately NOT part of this
     * declaration: a shortcut for third-party code is assigned by the
     * user in Settings, never shipped by the plugin. */
    enabled?: () => boolean;
}
/** PluginSettingsAPI (goal 0258 slice 1): the plugin's own declared
 * settings (manifest `contributes.settings`), served back typed. The
 * host renders the controls and stores the values -- a plugin never
 * builds a settings UI. get() answers the stored value or the
 * manifest default; onChange() fires whenever the user changes that
 * key (a face that depends on a setting re-renders itself from here
 * -- renderFace re-runs on object DATA changes only) and returns the
 * unsubscribe function. An undeclared key throws, naming the plugin.
 * A secretRef setting answers the picked vault entry's TITLE ('' when
 * none is picked or it no longer exists) -- never the value. */
export interface PluginSettingsAPI {
    get: (key: string) => boolean | string | number;
    onChange: (key: string, fn: (value: boolean | string | number) => void) => () => void;
}
/** PluginNoticeInput (goal 0277): a one-call transient message Mill
 * renders in its own notice surface (the footer pill), labelled with
 * the plugin's name. level defaults to 'info'; info/success leave on
 * their own after a few seconds, warning/error stay until dismissed.
 * action names one of THIS plugin's own registered commands (the id
 * given to registerCommand) as a secondary link. */
export interface PluginNoticeInput {
    text: string;
    level?: 'info' | 'success' | 'warning' | 'error';
    action?: {
        label: string;
        commandId: string;
    };
}
/** PluginStorageAPI (goal 0277): the plugin's own key-value store,
 * persisted centrally under the plugin id -- VS Code's globalState /
 * Obsidian's saveData shape. Values are any JSON-serialisable value
 * (a non-serialisable one throws at the door). get/keys are
 * synchronous over a cache loaded before activate(); set/delete
 * persist through the host and resolve when written. Storage is
 * plugin-private: nothing else in Mill reads it. */
export interface PluginStorageAPI {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    keys: () => string[];
}
/** ContentEntry (goal 0278): one thing on the board as api.query lists
 * it -- a card (kind 'card', subkind = its Atlas Kind id), a note
 * (kind 'note', payload.text), or a board object (its own kind, its
 * payload). title is the display name a person sees: a card's title,
 * a note's first line, an object's payload title or kind. */
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
    /** kind narrows to 'card', 'note', or one object kind; omitted lists
     * everything. */
    kind?: string;
    /** parentId narrows to one card's direct children. */
    parentId?: string;
}
/** PluginEventMap (goal 0278): the events a plugin can subscribe to.
 * 'contents:changed' fires whenever anything on the board is created,
 * edited, moved, or deleted, with the changed entry's id. A closed
 * map, so a new event is a type addition here, never a convention. */
export interface PluginEventMap {
    'contents:changed': {
        id: string;
    };
}
/** PluginFetchInit / PluginFetchResult (goal 0288): the network door.
 * A plugin never opens a connection -- api.fetch asks Mill, whose
 * guardrail rules allow, park in Review, or deny the request; on
 * approval Mill performs it host-side, confined to a host the
 * manifest's contributes.network declares (redirects included), and
 * hands the response back. A host or method the manifest does not
 * declare, or a non-http(s) URL, REJECTS the promise before any rule
 * runs; a denied or still-parked-then-denied request RESOLVES with
 * approved: false and the rule's label. */
export interface PluginFetchInit {
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    /** Attach a vault entry the user picked in one of this plugin's
     * secretRef settings (ADR-0048): Mill resolves it host-side after
     * the request is approved, sends it as `header` (default
     * Authorization) with `prefix` (default "Bearer "), and redacts the
     * value from the response. The value never reaches plugin code. */
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
/** PluginContentAPI (goal 0289): writes to the board through the SAME
 * guarded content plane an agent's writes take -- create a note, a
 * card, update a card, append a List row -- each evaluated by the
 * owner's guardrail rules (allow / park in Review / deny) with the
 * plugin as the named source, and recorded under the plugin's own
 * undo actor. Needs the "write-content" capability; without it every
 * call rejects before any rule runs. A denied write resolves with
 * approved: false and the rule's label; an approved one carries the
 * created (or updated) entity's id. */
export interface PluginWriteResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    id: string;
}
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
    /** createList (goal 0310) creates a Configure List: columns by display
     * name with an optional type (text | number | integer | boolean |
     * date | datetime; text when omitted) and optional first rows keyed
     * by column name. Resolves with the new list's id. */
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
/** PluginFilesAPI (goal 0310): list a folder on this machine through
 * Mill under the "list-files" capability -- a read-class action a rule
 * may deny or park; entries arrive only when approved. Hidden entries
 * and dependency folders never appear. */
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
export interface PluginFilesAPI {
    list: (path: string) => Promise<PluginListDirResult>;
}
/** PluginConvertAPI (goal 0282): pure transforms Mill already owns,
 * offered to a plugin as-is. htmlToMarkdown is the same conversion
 * every workflow convert step and every paste uses. No capability --
 * a transform reaches nothing outside its own input. */
export interface PluginConvertAPI {
    htmlToMarkdown: (html: string) => Promise<string>;
}
/** PluginViewDecl (goal 0290): a plugin-owned work tab. id must match a
 * view the manifest declares under contributes.views (which carries
 * the tab's title); render draws into a host-owned div sized to the
 * panel, plain DOM like renderFace, and runs once per mount -- the
 * panel stays mounted while its tab is hidden, and mounts again after
 * an app reload restores the tab. Opening the view is a registry
 * command, view.open.<plugin>.<id>, palette-reachable and callable
 * from the plugin's own commands. */
export interface PluginViewCtx {
    pluginId: string;
    viewId: string;
    /** The appearance this view is rendering under. */
    theme: PluginTheme;
    /** onThemeChange registers cb for every later appearance change. */
    onThemeChange: PluginThemeSubscribe;
}
export interface PluginViewDecl {
    id: string;
    render: (el: HTMLElement, ctx: PluginViewCtx) => void;
}
/** MillPluginAPI is the one object a plugin ever holds -- handed to its
 * exported activate(api), frozen by the host.
 * A capture (goal 0309): a quick-capture face the host shows in the
 * floating capture window, summoned from the Quick Panel or the
 * palette away from the canvas. render draws the face into el (a
 * host-owned div); the plugin writes through the content doors with
 * ctx.destinationId as the parent, then calls ctx.done() -- or
 * ctx.cancel() to close without writing. Declared in the manifest's
 * contributes.captures (id, label) so the Quick Panel can offer it
 * without running plugin code. */
export interface PluginCaptureCtx {
    /** destinationId is the card the user chose to land the capture in
     * ("" for the top level) -- pass it as parentId to a content door. */
    destinationId: string;
    done: () => void;
    cancel: () => void;
    /** The appearance this capture is rendering under. */
    theme: PluginTheme;
    /** onThemeChange registers cb for every later appearance change. */
    onThemeChange: PluginThemeSubscribe;
}
export interface PluginCaptureDecl {
    id: string;
    render: (el: HTMLElement, ctx: PluginCaptureCtx) => void;
}
export interface MillPluginAPI {
    millVersion: string;
    pluginId: string;
    registerCanvasObject: (decl: CanvasObjectDecl) => void;
    registerCommand: (decl: PluginCommandDecl) => void;
    requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>;
    settings: PluginSettingsAPI;
    /** notify shows a notice and returns its dismiss function. */
    notify: (input: PluginNoticeInput) => () => void;
    storage: PluginStorageAPI;
    /** query lists the board's contents (goal 0278); always the current
     * state, never a cache. */
    query: (q?: ContentQuery) => Promise<ContentEntry[]>;
    /** on subscribes to a host event and returns the unsubscribe function. */
    on: <K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void) => () => void;
    /** fetch performs a guarded HTTP request (goal 0288); see
     * PluginFetchInit for the contract. */
    fetch: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResult>;
    content: PluginContentAPI;
    convert: PluginConvertAPI;
    files: PluginFilesAPI;
    registerView: (decl: PluginViewDecl) => void;
    registerCapture: (decl: PluginCaptureDecl) => void;
}
/** A plugin's main.js default-exports (or named-exports) activate:
 * export function activate(api) { api.registerCanvasObject({...}) } */
export interface PluginModule {
    activate?: (api: MillPluginAPI) => void | Promise<void>;
    default?: {
        activate?: (api: MillPluginAPI) => void | Promise<void>;
    } | ((api: MillPluginAPI) => void | Promise<void>);
}
