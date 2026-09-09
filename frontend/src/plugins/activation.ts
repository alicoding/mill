import type { Manifest, PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { activationScriptUrl, buildFrameSrcdoc, hostTokenReader, millTokenCss, pluginAssetBase, type ActivationFrameInit } from '../app/pluginFrameBootstrap'
import { attachActivationBridge, createActivationFrameContext, sendExtensionCall, teardownActivationFrameContext, type ActivationFrameContext } from '../app/pluginActivationBridge'
import { buildPluginAPI } from './hostApi'
import { settingDeclsFromManifest, snapshotPluginSettings } from './pluginSettings'
import { buildPluginStorage } from './pluginStorage'
import { settingsPluginStorageDoors } from './pluginStorageHostDoors'
import { captureFramedExports, clearExports, setFramedExportCallHandler } from './extensionExports'

// Sandboxed activation for a third-party plugin with no canvas object
// (docs/goals/0375 S1b): main.js runs inside a hidden iframe instead of
// Mill's own document, over the SDK's bridged doors. Built-ins, and a
// non-built-in plugin that contributes a canvas object, keep same-DOM
// activation (loader.ts's own branch on info.Builtin and
// contributes.canvasObjects) -- this module only ever runs for the
// framed case.
//
// React cannot mount this frame: activation runs before main.tsx's
// loadPlugins() resolves, ahead of the app's own render. The frame is
// therefore created imperatively, exactly like the app shell's own
// pre-React DOM, and stays mounted (display:none, no UI) for the
// plugin's whole lifetime -- its registered commands and view/capture
// message relays keep working after activation finishes.

interface ActivationEntry {
  ctx: ActivationFrameContext
  detachBridge: () => void
}

const activations = new Map<string, ActivationEntry>()

// The reverse half of extension interop (goal 0364): when a captured
// export is framed, calling one of its methods means reaching INTO
// that plugin's own activation frame -- exactly the command.run-style
// round trip this module already owns the live contexts for. Installed
// once at module load, since extensionExports.ts must not import this
// module (loader.ts's own IMPORT DISCIPLINE: nothing this module
// imports may pull activation.ts forward of activation).
setFramedExportCallHandler((id, method, args) => {
  const entry = activations.get(id)
  if (!entry) return Promise.reject(new Error(`Extension ${id} is not running.`))
  return sendExtensionCall(entry.ctx, method, args)
})

// isFramedActivation decides which activation an extension gets. The
// deciding fact is its FACES, not its tools: a tool is declarative and
// runs the same either way (docs/goals/0380), but a face drawn by an
// extension's own function has to run where Mill's document is. So an
// extension whose canvas kinds all draw their faces from entry pages
// runs sandboxed, and one with any kind that draws its own face runs
// in Mill's document, behind the "canvas-host" grant for a
// non-built-in.

export function isFramedActivation(builtin: boolean, manifest: Manifest): boolean {
  const canvas = manifest.contributes?.canvasObjects ?? []
  if (canvas.length > 0) return canvas.every((kind) => !!kind.entry)
  return !builtin
}

// activateFramed builds the SAME host-side api object same-DOM
// activation hands to activate() (buildPluginAPI, unchanged) so every
// OTHER consumer (a view's/capture's/face's own PluginFrame) keeps
// answering pluginAPIFor(pluginId) -- then creates the hidden
// activation frame and awaits its own activation-done/error signal,
// the framed twin of `await Promise.resolve(activate(api))`.
export async function activateFramed(info: PluginInfo, millVersion: string, storageSnapshot: Record<string, string>): Promise<void> {
  const manifest = info.Manifest
  const pluginId = manifest.id
  const api = buildPluginAPI(manifest, millVersion, storageSnapshot)
  teardownActivationFrame(pluginId)

  const storage = buildPluginStorage(pluginId, storageSnapshot, settingsPluginStorageDoors(pluginId))
  const decodedStorage: Record<string, unknown> = {}
  for (const key of storage.keys()) decodedStorage[key] = storage.get(key)
  const exportAllowlist = manifest.exports ?? []
  const init: ActivationFrameInit = {
    pluginId,
    millVersion,
    version: manifest.version,
    settings: snapshotPluginSettings(manifest),
    storage: decodedStorage,
    exports: exportAllowlist,
    capabilities: [...(manifest.capabilities ?? [])],
  }
  const srcdoc = buildFrameSrcdoc(pluginAssetBase(pluginId), [activationScriptUrl()], '', init, millTokenCss(hostTokenReader()))

  const frame = document.createElement('iframe')
  // No allow-same-origin, matching every other framed surface: the
  // activation document's origin stays opaque.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('data-testid', `plugin-activation-frame-${pluginId}`)
  frame.setAttribute('title', `${manifest.name || pluginId} activation`)
  frame.style.display = 'none'
  document.body.appendChild(frame)
  frame.srcdoc = srcdoc

  const ctx = createActivationFrameContext(frame, pluginId, settingDeclsFromManifest(manifest), manifest)
  await new Promise<void>((resolve, reject) => {
    const detachBridge = attachActivationBridge({
      ctx,
      api,
      onDone: (exported) => {
        // Captured (goal 0364) even when exported is undefined -- an
        // empty {data:{}, methods:[]} registers the plugin as RUNNING
        // with nothing exported, so a dependant sees "activated, no
        // methods" rather than "not running" for a plugin that simply
        // returned nothing from activate().
        captureFramedExports(pluginId, exportAllowlist, exported?.data, exported?.methods)
        resolve()
      },
      onError: (message) => reject(new Error(message)),
    })
    activations.set(pluginId, { ctx, detachBridge })
  })
}

// teardownActivationFrame removes one plugin's activation frame and
// ends its bridge (docs/goals/0375 S1b, "unload/reload tears the frame
// down"): a torn-down frame's registered commands answer disabled
// (ctx.alive), and nothing it registers again collides with a stale
// registration, since collectPluginCommand/View/Capture's own sweep
// (pluginReload.ts) runs alongside this.
export function teardownActivationFrame(pluginId: string): void {
  const entry = activations.get(pluginId)
  if (!entry) return
  teardownActivationFrameContext(entry.ctx)
  entry.detachBridge()
  entry.ctx.frame.remove()
  activations.delete(pluginId)
  clearExports(pluginId)
}
