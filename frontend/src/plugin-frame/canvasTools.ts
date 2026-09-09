import type { CanvasDraft, CanvasMeasureResult, CanvasToolCtx, CanvasToolDecl, CanvasToolPointerEvent } from '../plugins/sdk/canvasTools'
import { toolWireDescriptor } from '../plugins/canvasToolProtocol'

// The framed half of the canvas tool contract (docs/goals/0380): a
// tool declares itself over the bridge, then Mill drives it through
// pointer phases and it answers with draft writes. Nothing here
// touches a DOM it did not create -- there is none to touch, since
// this document is a hidden activation frame on an opaque origin.
//
// Split out of activation.ts so both stay small; the bundler folds it
// back into the one self-contained IIFE that frame actually loads.

// CANVAS_TOOL_CALLS is every RPC name this module invokes, in the
// same one-place-per-side shape ACTIVATION_CALL_METHODS carries, so
// the protocol-surface test can check it against the host's own
// CANVAS_TOOL_DOORS instead of the two drifting apart.
export const CANVAS_TOOL_CALLS = [
    'register.tool',
    'object.create', 'object.patch', 'object.commit', 'object.discard',
    'object.measure',
    'files.saveImageBytes',
    'board.eraseAt', 'board.eraseCommit',
] as const

export type FrameCall = (method: string, ...args: unknown[]) => Promise<unknown>

export interface CanvasToolsFrameHalf {
    registerCanvasTool: (decl: CanvasToolDecl) => void
    measure: (markup: string, maxWidth: number) => Promise<CanvasMeasureResult>
    saveImageBytes: (base64: string, ext: string, title: string) => Promise<string>
    // onToolPointer routes one host->frame 'tool.pointer' event onto the
    // tool that declared itself under that id.
    onToolPointer: (payload: Record<string, unknown>) => void
}

// draftHandle wraps one host-issued draft id into the three calls a
// tool actually makes on it. Every one is a round trip, so each is a
// promise -- a tool that fires and forgets still gets the ordering
// postMessage guarantees, in the order it made the calls.
function draftHandle(call: FrameCall, id: string): CanvasDraft {
    return {
        id,
        patch: (patch) => call('object.patch', { id, ...patch }).then(() => undefined),
        commit: (opts) => call('object.commit', { id, select: !!opts?.select }).then((r) => (r as { id: string | null } | null)?.id ?? null),
        discard: () => call('object.discard', { id }).then(() => undefined),
    }
}

function toolCtx(call: FrameCall, decl: CanvasToolDecl, event: CanvasToolPointerEvent, canErase: boolean): CanvasToolCtx {
    const ctx: CanvasToolCtx = {
        styleValues: event.styleValues || {},
        createDraft: (input) => call('object.create', { toolId: decl.kind, kind: decl.objectKind || decl.kind, at: input.at, size: input.size, data: input.data || {}, preview: input.preview || {} })
            .then((r) => draftHandle(call, (r as { id: string }).id)),
    }
    if (canErase) {
        ctx.eraseAt = (at) => call('board.eraseAt', { toolId: decl.kind, at }).then(() => undefined)
        ctx.commitErase = () => call('board.eraseCommit', { toolId: decl.kind }).then(() => undefined)
    }
    return ctx
}

export function buildCanvasToolsFrameHalf(call: FrameCall, pluginId: string, capabilities: readonly string[]): CanvasToolsFrameHalf {
    const tools = new Map<string, CanvasToolDecl>()
    const canErase = capabilities.indexOf('erase-board-items') !== -1

    return {
        registerCanvasTool: (decl: CanvasToolDecl) => {
            tools.set(decl.kind, decl)
            void call('register.tool', toolWireDescriptor(decl)).catch((err: unknown) => console.error(`plugin ${pluginId}: registerCanvasTool failed`, err))
        },
        measure: (markup: string, maxWidth: number) => call('object.measure', { markup, maxWidth }) as Promise<CanvasMeasureResult>,
        saveImageBytes: (base64: string, ext: string, title: string) => call('files.saveImageBytes', base64, ext, title) as Promise<string>,
        onToolPointer: (payload: Record<string, unknown>) => {
            const decl = tools.get(String(payload.toolId))
            if (!decl) return
            const event = payload as unknown as CanvasToolPointerEvent
            // A tool's own handler is plugin code: a throw inside it
            // must not take the frame's message pump down with it.
            try {
                void Promise.resolve(decl.onPointer(event, toolCtx(call, decl, event, canErase)))
                    .catch((err: unknown) => console.error(`plugin ${pluginId}: tool "${decl.kind}" failed`, err))
            } catch (err) {
                console.error(`plugin ${pluginId}: tool "${decl.kind}" failed`, err)
            }
        },
    }
}
