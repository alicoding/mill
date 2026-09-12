import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { thirdPartyNounFor, unregisterThirdPartyNouns } from '../atlas/atlasNounRegistry'
import { callCanvasToolDoor, forgetCanvasTools, framedObjectFaceEntry, type CanvasToolDoorContext } from './canvasToolHostDoors'
import { unregisterPluginCommands } from './pluginCommands'

// This host-door unit enters the dependency graph from below the normal
// activation bridge. Stub the DOM face adapter it does not exercise so
// loader -> activation -> bridge cannot loop back into a half-evaluated
// CANVAS_TOOL_DOORS binding.
vi.mock('./PluginFaceContent', () => ({
  pluginFaceComponent: () => () => null,
  pluginObjectCtx: () => ({}),
}))

const MANIFEST = {
  id: 'face-probe', name: 'Face probe', version: '1.0.0', capabilities: [],
  contributes: { canvasObjects: [{ kind: 'probe', entry: 'face.html', tool: true }] },
} as unknown as Manifest

function context(): CanvasToolDoorContext {
  return { pluginId: 'face-probe', manifest: MANIFEST, post: () => {} }
}

describe('register.face manifest ownership', () => {
  afterEach(() => {
    forgetCanvasTools('face-probe')
    unregisterThirdPartyNouns('face-probe')
    unregisterPluginCommands('face-probe')
  })

  it('records only the exact kind and entry declared by the manifest, then teardown removes it', async () => {
    await expect(callCanvasToolDoor(context(), 'register.face', [{ objectKind: 'probe', entry: 'face.html' }])).resolves.toBe(true)
    expect(framedObjectFaceEntry('face-probe', 'probe')).toBe('face.html')
    forgetCanvasTools('face-probe')
    expect(framedObjectFaceEntry('face-probe', 'probe')).toBeUndefined()
  })

  it('rejects an undeclared kind or mismatched entry without recording either', async () => {
    await expect(callCanvasToolDoor(context(), 'register.face', [{ objectKind: 'other', entry: 'face.html' }])).rejects.toThrow(/exactly match/)
    await expect(callCanvasToolDoor(context(), 'register.face', [{ objectKind: 'probe', entry: 'other.html' }])).rejects.toThrow(/exactly match/)
    expect(framedObjectFaceEntry('face-probe', 'other')).toBeUndefined()
    expect(framedObjectFaceEntry('face-probe', 'probe')).toBeUndefined()
  })

  it('uses the accepted manifest entry when the tool seats its existing persisted-kind alias', async () => {
    await callCanvasToolDoor(context(), 'register.face', [{ objectKind: 'probe', entry: 'face.html' }])
    await expect(callCanvasToolDoor(context(), 'register.tool', [{
      kind: 'probe', objectKind: 'placed-probe', label: 'Probe', icon: 'circle',
      source: 'board-local', editRoute: 'none', styleFields: [],
    }])).resolves.toBe(true)

    const noun = thirdPartyNounFor('probe')
    expect(noun?.boardObjectKind).toBe('placed-probe')
    expect(noun?.content?.Component).toBeDefined()
    expect(noun?.content?.input).toBe('interactive')
  })
})
