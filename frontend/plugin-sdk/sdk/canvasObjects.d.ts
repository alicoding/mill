import type { PluginTheme, PluginThemeSubscribe } from './theme';
import type { GuardedActionResult } from './guardedAction';
export interface CanvasObjectDecl {
    /** kind is the tool's tray/palette id and, unless objectKind says
     * otherwise, the kind every placed instance is stored under --
     * lowercase slug, must be unique against Mill's own tools and every
     * other plugin. */
    kind: string;
    /** objectKind: the stored kind this tool's placements carry, when it
     * differs from the tool id (useful when one tool id should place
     * several visually distinct kinds). Defaults to `kind`; must be
     * unique among every registered object kind like any other. */
    objectKind?: string;
    /** label/description are user-facing: the tray tooltip and the
     * plugin's row in Settings. */
    label: string;
    description?: string;
    /** icon is one emoji, or the name of a glyph from Mill's named icon
     * set ('pencil', 'zap', 'trash', 'diamond', 'square', 'circle',
     * 'arrow-up-right') so the tool gets a real toolbar icon with no
     * image asset required. An unrecognized name fails registration,
     * naming the known set. */
    icon: string;
    /** shortcutKey: a single A-Z key that arms this tool on the board,
     * shown as the tray button's key chip. A key another tool already
     * uses fails registration. */
    shortcutKey?: string;
    /** group: which cluster of the board's creation dock this tool joins
     * — 'objects' (the things a board is made of), 'media' (the Media
     * flyout, shared with images and dropped files), 'annotate' (the
     * freehand-marking flyout), or 'embed' (the default): reachable by
     * name from the dock's More panel, which searches every registered
     * tool. The dock's own visible buttons are fixed, so a tool joining a
     * full cluster is found through More rather than pushing a button
     * off the dock. */
    group?: 'objects' | 'media' | 'annotate' | 'embed';
    /** lockable: for a non-sticky drag tool only — re-clicking the
     * armed button locks it for deliberate repeated use instead of
     * disarming. */
    lockable?: boolean;
    /** dragBand: whether a placed object needs the shared chrome band as
     * its drag surface (default true). Set false when the object's whole
     * body already captures pointer events for dragging on its own. */
    dragBand?: boolean;
    /** Where the object's own artifact lives: a value only this board
     * knows ('board-local'), a web address ('url'), or a file on disk
     * ('file'). */
    source: 'board-local' | 'url' | 'file';
    /** Which door edits the object: 'inline' (the face itself is the
     * editor), 'external-app', or 'none' — one fixed value, or a
     * resolver called per object when the answer depends on that
     * object's own data (some file extensions are editable in place and
     * some are not, say). */
    editRoute: CanvasEditRoute | ((object: CanvasObjectRef) => CanvasEditRoute);
    /** The payload a fresh placement starts with. */
    defaultPayload?: Record<string, string>;
    /** The authoring gesture. 'arm-then-click' (the default): the armed
     * click places one object with defaultPayload. 'drag-to-draw': the
     * armed pointer drag feeds `gesture`, whose own onEnd decides what to
     * create. 'ephemeral-drag': the drag renders only a live preview and
     * never creates anything (a laser pointer); source, editRoute and
     * renderFace go unused for it. */
    interaction?: 'arm-then-click' | 'drag-to-draw' | 'ephemeral-drag';
    /** Whether the tool stays armed after a completed drag (for repeated
     * strokes) or disarms after one. Only meaningful for a drag
     * interaction; defaults to true there. */
    sticky?: boolean;
    /** The tool's styleable properties, from Mill's own closed style
     * vocabulary. Declaring any makes a style picker render next to the
     * armed tool automatically; the picker's current values arrive on
     * the gesture ctx keyed by each field's own `key`, starting at its
     * `default`. */
    styleFields?: readonly CanvasStyleFieldDecl[];
    /** The drag behavior for a 'drag-to-draw' or 'ephemeral-drag'
     * interaction. Required there, and not accepted for
     * 'arm-then-click'. */
    gesture?: CanvasGestureDecl;
    /** menuItems: this object kind's own context-menu items, rendered on
     * the right-click menu of the plugin's OWN objects only, between
     * Mill's built-in items and Delete. An item whose enabled predicate
     * returns false is left out of the menu entirely rather than shown
     * disabled. */
    menuItems?: readonly CanvasObjectMenuItem[];
    /** renderFace draws the object's board face into el (an element
     * already sized to the object's box). Called on mount and again
     * whenever the object's own data changes — el's contents are yours
     * to manage between calls. Deliberately plain DOM: no renderer
     * library coupling, no build step required to write a plugin.
     * Optional only for 'ephemeral-drag' (nothing is ever placed). */
    renderFace?: (el: HTMLElement, ctx: CanvasObjectFaceCtx) => void;
}
/** Mill's closed style vocabulary, restated as plain data so the SDK
 * never needs a build step to describe it. Each field's `key` names
 * the value that arrives on a gesture's styleValues and a face's
 * ctx.object payload once placed; `label` is the picker row's
 * accessible name (defaults to "<tool label> <key>"). 'shape-kind'
 * options name their icons from the same glyph set
 * CanvasObjectDecl.icon accepts. */
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
 * space, with its capture timestamp (only an 'ephemeral-drag' tool
 * needs `t`, to age points out; every other tool can ignore it). */
export interface CanvasGesturePoint {
    x: number;
    y: number;
    t: number;
}
export type CanvasEditRoute = 'inline' | 'external-app' | 'none';
/** The object an edit-route resolver function receives. */
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
    /** Converts a gesture point's client position into board coordinates. */
    screenToFlowPosition: (p: {
        x: number;
        y: number;
    }) => {
        x: number;
        y: number;
    };
    /** The tool's current style-picker values, keyed by each declared
     * field's own `key`, falling back to that field's default. */
    styleValues: Record<string, string | number>;
    /** Creates one instance of THIS plugin's object at a board position,
     * participating in undo exactly like a click placement. opts.size
     * sets the placed object's persisted size in board units; opts.select
     * selects it right after placement. */
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
    /** Saves bytes into Mill's own file store and resolves with the
     * stored file's path, ready to use as a file-backed object's payload
     * (draw, save as SVG, place with the returned path is the shape of
     * a drawing tool). base64 is the file's content; ext is a lowercase
     * ".ext". */
    saveImageBytes: (base64: string, ext: string, title: string) => Promise<string>;
    /** The ids of the board's top-level cards, notes and objects whose
     * CENTER falls inside a board-space rect — the same enclosure rule
     * Mill's own Area tool uses. */
    itemsInRect: (rect: CanvasRect) => CanvasItemsInRect;
    /** eraseHitTest/commitErase are present ONLY when the plugin's
     * manifest declares the "erase-board-items" capability.
     * eraseHitTest accumulates whatever board item sits under the point
     * (top-level items only, never a container's children);
     * commitErase erases the whole accumulated set through the same
     * undoable delete a person's own Delete key uses, as one undo step. */
    eraseHitTest?: (pt: {
        x: number;
        y: number;
    }) => void;
    commitErase?: () => void;
}
export interface CanvasGestureDecl {
    /** Called for each accumulated point while the drag is live. */
    onPoint?: (pt: CanvasGesturePoint, ctx: CanvasGestureCtx) => void;
    /** Called once at pointer-up with the FULL point list — a stray
     * click included, so deciding what counts as a real gesture (a
     * distance threshold, a point count) is your own call. */
    onEnd: (points: CanvasGesturePoint[], ctx: CanvasGestureCtx) => void;
    /** Draws the live in-drag preview into el (an overlay element
     * spanning the board) — called on every point and, for an
     * ephemeral-drag tool, on every fade frame. el's contents are yours
     * to manage between calls. */
    renderPreview?: (el: HTMLElement, points: CanvasGesturePoint[], now: number) => void;
    /** For an ephemeral-drag tool: accumulated points age out over this
     * many milliseconds instead of clearing at pointer-up. */
    fadeMs?: number;
}
export interface CanvasObjectMenuItem {
    id: string;
    label: string;
    run: (ctx: CanvasObjectFaceCtx) => void;
    enabled?: (ctx: CanvasObjectFaceCtx) => boolean;
}
export interface CanvasObjectFaceCtx {
    object: {
        ID: string;
        Kind: string;
        Payload: Record<string, string>;
        /** The object's persisted size in board units, or null until the
         * user first resizes it. */
        Size: {
            W: number;
            H: number;
        } | null;
    };
    /** For a file-backed object: the mirrored file's current bytes as a
     * data: URL once loaded (null while loading), and whether the read
     * failed. Binary files (images, sheets, pdf) arrive as base64 data:
     * URLs with their MIME type; text files (markdown, json, csv, .env)
     * arrive as percent-encoded text/plain data: URLs. renderFace re-runs
     * whenever either changes. Absent for a board-local or url-backed
     * object. */
    mirror?: {
        dataUrl: string | null;
        failed: boolean;
    };
    /** Merges patch into this object's payload (an empty string value
     * deletes that key). The write persists, syncs, and participates in
     * undo like any built-in edit. */
    updatePayload: (patch: Record<string, string>) => Promise<void>;
    /** Asks Mill to perform an action the plugin cannot perform itself.
     * The action's kind must be one this plugin's manifest declares as a
     * capability; each use is evaluated by the person's own guardrail
     * rules and may require their live approval. */
    requestGuardedAction: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>;
    /** The appearance this face is rendering under. */
    theme: PluginTheme;
    /** Subscribes to every later appearance change. */
    onThemeChange: PluginThemeSubscribe;
    /** Attaches el to the page OFF the board, at exactly `size` CSS
     * pixels and unscaled by the board's zoom, and returns the function
     * that detaches it. A face is CSS-scaled with the canvas, so an
     * engine that measures its own layout from screen rectangles (a
     * mind-map or graph layout, a text-measuring chart) lays out wrong
     * rendered directly in place — render it on this offscreen stage at
     * the face's real size, then copy the finished drawing into el.
     * Anything still mounted when the face unmounts is detached
     * automatically. */
    mountOffBoard: (el: Element, size: {
        w: number;
        h: number;
    }) => () => void;
}
