import type { CanvasObjectDecl } from './canvasObjects';
import type { GuardedActionResult } from './guardedAction';
import type { PluginCommandDecl } from './commands';
import type { PluginSettingsAPI } from './settings';
import type { PluginNoticeInput } from './notify';
import type { PluginStorageAPI } from './storage';
import type { ContentQuery, ContentEntry, KindInfo, PluginEventMap, PluginFetchInit, PluginFetchResult, PluginFetchJSONResult, PluginContentAPI, PluginFilesAPI, PluginConvertAPI } from './content';
import type { PluginViewDecl, PluginViewHandle } from './views';
import type { PluginCaptureDecl, PluginCaptureHandle } from './captures';
import type { PluginUIAPI } from './ui';
export interface MillPluginAPI {
    millVersion: string;
    pluginId: string;
    registerCanvasObject: (decl: CanvasObjectDecl) => void;
    registerCommand: (decl: PluginCommandDecl) => void;
    /** Asks Mill to perform an action the plugin cannot perform itself.
     * See CanvasObjectFaceCtx's own requestGuardedAction for the full
     * contract — this is the same door, callable outside a face. */
    requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>;
    settings: PluginSettingsAPI;
    /** Shows a notice and returns its dismiss function. */
    notify: (input: PluginNoticeInput) => () => void;
    storage: PluginStorageAPI;
    /** Lists the board's contents — always the current state, never a
     * cache. */
    query: (q?: ContentQuery) => Promise<ContentEntry[]>;
    /** Lists the board's card kinds: the schema each card's own `fields`
     * values read against. */
    kinds: () => Promise<KindInfo[]>;
    /** Opens one card the way a projection's own card click does: the
     * board view, with that card's page on top of it. */
    open: (cardId: string) => void;
    /** Subscribes to a host event and returns the unsubscribe function.
     * filter narrows delivery: a 'contents:changed' filter { kinds }
     * delivers only changes of those kinds ('card' changes, say), so a
     * view re-querying on every change pays only for its own. */
    on: <K extends keyof PluginEventMap>(event: K, handler: (payload: PluginEventMap[K]) => void, filter?: {
        kinds?: string[];
    }) => () => void;
    /** Performs a guarded HTTP request; see PluginFetchInit for the full
     * contract. */
    fetch: (url: string, init?: PluginFetchInit) => Promise<PluginFetchResult>;
    /** Sugar over fetch for a JSON API: parses the body and never
     * throws, not even for a denied request, a non-2xx status or a body
     * that isn't JSON — see PluginFetchJSONResult. */
    fetchJSON: <T = unknown>(url: string, init?: PluginFetchInit) => Promise<PluginFetchJSONResult<T>>;
    content: PluginContentAPI;
    convert: PluginConvertAPI;
    files: PluginFilesAPI;
    registerView: (decl: PluginViewDecl) => PluginViewHandle;
    registerCapture: (decl: PluginCaptureDecl) => PluginCaptureHandle;
    ui: PluginUIAPI;
    /** Formats an ISO timestamp the way Mill's own interface does:
     * 'relative' (the default) reads "2m ago"/"yesterday", falling back
     * to a short date beyond about a week; 'short' is a locale date;
     * 'long' is a locale date and time. An unparseable iso answers
     * '—'. */
    formatDate: (iso: string, style?: 'relative' | 'short' | 'long') => string;
}
/** A plugin's main.js default-exports (or named-exports) activate:
 * export function activate(api) { api.registerCanvasObject({...}) } */
export interface PluginModule {
    activate?: (api: MillPluginAPI) => void | Promise<void>;
    default?: {
        activate?: (api: MillPluginAPI) => void | Promise<void>;
    } | ((api: MillPluginAPI) => void | Promise<void>);
}
