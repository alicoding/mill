import type { Manifest, PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { activationScriptUrl, buildFrameSrcdoc, hostTokenReader, millTokenCss, pluginAssetBase, type ActivationFrameInit } from '../app/pluginFrameBootstrap'
import { attachActivationBridge, createActivationFrameContext, teardownActivationFrameContext, type ActivationFrameContext } from '../app/pluginActivationBridge'
import { buildPluginAPI } from './hostApi'
import { settingDeclsFromManifest, snapshotPluginSettings } from './pluginSettings'
import { buildPluginStorage } from './pluginStorage'

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

// isFramedActivation is the one branch this slice adds (docs/goals/
// 0375 S1b's binding scope): a built-in keeps same-DOM behind its own
// named transition (the tools API, S1c); a non-built-in that declares
// a canvas object keeps same-DOM behind the "canvas-host" grant, until
// the framed canvas API exists (goal 0380). Every other non-built-in
// plugin activates framed.
export function isFramedActivation(builtin: boolean, manifest: Manifest): boolean {
  return !builtin && (manifest.contributes?.canvasObjects ?? []).length === 0
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

  const storage = buildPluginStorage(pluginId, storageSnapshot)
  const decodedStorage: Record<string, unknown> = {}
  for (const key of storage.keys()) decodedStorage[key] = storage.get(key)
  const init: ActivationFrameInit = {
    pluginId,
    millVersion,
    version: manifest.version,
    settings: snapshotPluginSettings(manifest),
    storage: decodedStorage,
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

  const ctx = createActivationFrameContext(frame, pluginId, settingDeclsFromManifest(manifest))
  await new Promise<void>((resolve, reject) => {
    const detachBridge = attachActivationBridge({
      ctx,
      api,
      onDone: resolve,
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
}
