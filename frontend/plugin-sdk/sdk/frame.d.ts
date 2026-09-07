import type { PluginTheme } from './theme';
/** The events Mill pushes into an entry page.
 *
 * `theme:changed` carries the resolved appearance; Mill has already
 * swapped the page's own theme variables by the time it fires, so
 * only a page that paints pixels itself needs to listen.
 * `settings:changed` says a stored setting moved; read the new value
 * with `call('settings.get', key)`. `contents:changed` says the board
 * changed. `ctx` carries the surface's context, on mount and on every
 * change: a capture's destination arrives here, and a canvas object's
 * face receives `{ object: { ID, Kind, Payload, Size }, mirror? }` --
 * `mirror` only for a file-backed kind, as `{ dataUrl, failed }`.
 * `resize` carries the `{ width, height }` of the box the page is
 * drawn in. */
export type MillFrameEvent = 'theme:changed' | 'settings:changed' | 'contents:changed' | 'ctx' | 'resize';
/** What `window.acquireMillApi()` answers inside an entry page.
 *
 * The page runs sandboxed with no same-origin access, under a policy
 * that loads scripts, styles, fonts and images from your own plugin
 * folder only, and makes no network requests of its own: use
 * `call('fetch', url, init)`, which goes through the same declared
 * hosts and the same approval every plugin request does. Script must
 * arrive as a file the page loads with `<script src>`; an inline
 * `<script>` and an `onclick` attribute never run.
 *
 * The page also answers `window.acquireVsCodeApi()`, returning
 * `postMessage`, `getState` and `setState` under the names a webview
 * written for that editor already calls, so such a page drops in
 * unchanged. Acquiring it twice throws, as it does there. */
export interface MillFrameApi {
    /** Calls one plugin door and resolves with its answer. The doors a
     * page may call are `settings.get`, `notify`, `storage.get`,
     * `storage.set`, `storage.delete`, `query`, `fetch`,
     * `content.createNote`, `content.createCard`, `content.updateCard`,
     * `content.appendListRow`, `content.createList`, `files.list`,
     * `convert.htmlToMarkdown`, `requestGuardedAction`, `runCommand`,
     * in a capture, `capture.done` and `capture.cancel`, and in a canvas
     * object's face, `object.updatePayload` (merge a patch into this
     * object's payload; an empty string deletes a key) and
     * `object.setEditing` (true while your editor is open). Anything
     * else rejects, saying so by name. */
    call: (method: string, ...args: unknown[]) => Promise<unknown>;
    /** Sends a value to the plugin's own `onMessage` handler. */
    postMessage: (message: unknown) => void;
    /** Receives what the plugin sent with its view or capture handle.
     * Returns the unsubscribe function. */
    onMessage: (handler: (message: unknown) => void) => () => void;
    /** Subscribes to one host event. Returns the unsubscribe function. */
    on: (event: MillFrameEvent, handler: (payload: unknown) => void) => () => void;
    /** The value this page last stored with setState, or undefined the
     * first time it opens. */
    getState: () => unknown;
    /** Remembers one value for this surface. It is kept in the plugin's
     * own storage, so it survives closing the tab and restarting Mill. */
    setState: (state: unknown) => unknown;
    /** The appearance the page is drawn under, always current. */
    readonly theme: PluginTheme;
    /** The surface's context, always current: a capture's chosen
     * destination, a view's own ids. */
    readonly context: Record<string, unknown>;
}
