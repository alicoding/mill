import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { boardObjectContentFor, registerBoardObjectContent } from './atlasNounRegistry'
import { dispatchObjectEdit, resolveObjectSourceKey } from './objectSeams'

vi.mock('../shared/bindings', () => ({
  AtlasService: { OpenObjectMirrorInDefaultApp: vi.fn().mockResolvedValue(undefined) },
}))

// The fake-extension contract test (ADR-0046, goal 0244 S0, mirroring
// drawioEmbedProtocol.test.ts's own no-catch-up-tax shape): a fake noun
// registered with only ITS OWN declared seams -- Component/ariaLabelKey/
// role/dragBand/fileBacked/source/editRoute -- proving the content well
// + source + edit-route contract holds for ANY registrant, not just the
// four in-tree Kinds, and that resolving a source key and dispatching an
// edit never requires the extension to import AtlasService (or any other
// kernel binding) itself. This must keep passing unmodified across a
// real object-type swap, since it asserts only the documented contract
// shape, never an in-tree Kind's own internals.
function fakeBoardObject(payload: Record<string, string>): BoardObject {
  return {
    ID: 'fake-object-1',
    Kind: 'fake-extension-kind',
    Payload: payload,
    Position: { X: 0, Y: 0 },
    ParentID: '',
    CreatedAt: '',
    UpdatedAt: '',
    DeletedAt: '',
    BuiltIn: false,
    Seed: 0,
  } as unknown as BoardObject
}

describe('canvas-object extension contract (ADR-0046, goal 0244 S0)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a fake file-backed/external-app extension\'s source key and dispatches its edit through the host, with no kernel call of the extension\'s own', async () => {
    registerBoardObjectContent('fake-extension-kind' as never, {
      Component: () => null,
      ariaLabelKey: 'boardObject.imageAriaLabel',
      role: undefined,
      dragBand: false,
      fileBacked: false,
      source: { kind: 'file', pathKey: 'mirrorPath' },
      editRoute: { kind: 'external-app' },
    })

    const content = boardObjectContentFor('fake-extension-kind')
    expect(content?.source).toEqual({ kind: 'file', pathKey: 'mirrorPath' })
    expect(content?.editRoute).toEqual({ kind: 'external-app' })
    // fileBacked is DERIVED from source once declared (the caller's own
    // literal `false` above is superseded), never independently trusted.
    expect(content?.fileBacked).toBe(true)

    const object = fakeBoardObject({ mirrorPath: '/tmp/fake-sheet.xlsx' })

    // The host resolves the declared source key -- the fake extension
    // never reads object.Payload.mirrorPath itself.
    expect(resolveObjectSourceKey(object, content!.source!)).toBe('/tmp/fake-sheet.xlsx')

    // The fake extension only ever DECLARES editRoute; dispatching it is
    // exclusively dispatchObjectEdit's job, which is the sole caller of
    // AtlasService below.
    await dispatchObjectEdit(object, content!.editRoute!)
    expect(AtlasService.OpenObjectMirrorInDefaultApp).toHaveBeenCalledTimes(1)
    expect(AtlasService.OpenObjectMirrorInDefaultApp).toHaveBeenCalledWith('fake-object-1')
  })

  it('a provider-sourced extension resolves its refKey the same way a file-sourced one resolves pathKey', () => {
    registerBoardObjectContent('fake-provider-kind' as never, {
      Component: () => null,
      ariaLabelKey: 'boardObject.tableAriaLabel',
      role: undefined,
      dragBand: false,
      fileBacked: true,
      source: { kind: 'provider', refKey: 'listID' },
      editRoute: { kind: 'none' },
    })

    const content = boardObjectContentFor('fake-provider-kind')
    // fileBacked is derived false here -- a provider source is never a
    // file, regardless of what the caller's own literal claimed.
    expect(content?.fileBacked).toBe(false)

    const object = fakeBoardObject({ listID: 'list-42' })
    expect(resolveObjectSourceKey(object, content!.source!)).toBe('list-42')
  })

  it('embedded-engine and inline routes never touch AtlasService', async () => {
    const object = fakeBoardObject({})
    await dispatchObjectEdit(object, { kind: 'inline' })
    await dispatchObjectEdit(object, { kind: 'none' })
    expect(AtlasService.OpenObjectMirrorInDefaultApp).not.toHaveBeenCalled()
  })
})
