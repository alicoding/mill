import type { PluginTheme, PluginThemeSubscribe } from './theme';
export interface PluginViewCtx {
    pluginId: string;
    viewId: string;
    /** The appearance this view is rendering under. */
    theme: PluginTheme;
    /** Subscribes to every later appearance change. */
    onThemeChange: PluginThemeSubscribe;
}
/** What registerView answers: the plugin's end of the two-way channel
 * to its own entry page. postMessage delivers a value to the page's
 * `onMessage` handlers, and the page's own `postMessage` arrives at the
 * `onMessage` this declaration carries. On a view that renders into
 * Mill's document instead of a page, postMessage has nowhere to
 * deliver and does nothing. */
export interface PluginViewHandle {
    postMessage: (message: unknown) => void;
}
/** id must match a view the manifest declares under contributes.views,
 * which carries the tab's title and the entry page when there is one.
 * A view whose manifest names an entry page needs no render at all,
 * and needs registerView only to exchange messages with that page.
 * render draws into an element sized to the panel, plain DOM like a
 * canvas object's face, and runs once per mount: the panel stays
 * mounted while its tab is hidden, and mounts again after a reload
 * restores the tab. Opening the view is a registry command,
 * view.open.<plugin>.<id>, reachable from the palette and callable
 * from the plugin's own commands. */
export interface PluginViewDecl {
    id: string;
    render?: (el: HTMLElement, ctx: PluginViewCtx) => void;
    /** Receives whatever the entry page sent through its own
     * postMessage. */
    onMessage?: (message: unknown) => void;
}
