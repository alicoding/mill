import { describe, expect, it, vi } from 'vitest'

const listDeviceRefsMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  RemoteAuthService: { ListDeviceRefs: listDeviceRefsMock },
}))

import { fetchOptionsSourceItems, parseSelectedIds } from './arrayOptionsSource'

// A stand-in translator matching the shape ArrayOptionsField passes
// its own i18next `t` -- exercises the SAME interpolation keys/labels
// the real picker renders, without a React render (this repo's
// toolchain has no @testing-library/react, HotkeyHint.tsx's own note).
function fakeT(key: string, opts?: Record<string, unknown>): string {
  if (key === 'nodeInspector.deviceOptionLabel') return `${opts?.label as string} · ${opts?.kind as string}`
  if (key.startsWith('nodeInspector.deviceKind.')) return key.slice('nodeInspector.deviceKind.'.length)
  return key
}

describe('fetchOptionsSourceItems', () => {
  it('resolves the "devices" source into labeled items, passing Needs through to the directory call', async () => {
    listDeviceRefsMock.mockResolvedValueOnce([
      { id: 'dev-1', label: 'Phone', kind: 'phone', accepts: ['notification'] },
      { id: 'dev-2', label: 'Chrome', kind: 'browser', accepts: ['browser-replay'] },
    ])

    const items = await fetchOptionsSourceItems('devices', ['notification'], fakeT)

    expect(listDeviceRefsMock).toHaveBeenCalledWith(['notification'])
    expect(items).toEqual([
      { id: 'dev-1', label: 'Phone · phone' },
      { id: 'dev-2', label: 'Chrome · browser' },
    ])
  })

  it('passes null Needs through unfiltered when the field declares none', async () => {
    listDeviceRefsMock.mockResolvedValueOnce([])
    await fetchOptionsSourceItems('devices', undefined, fakeT)
    expect(listDeviceRefsMock).toHaveBeenCalledWith(null)
  })

  it('resolves an unrecognized source to no options rather than throwing', async () => {
    const items = await fetchOptionsSourceItems('not-a-real-source', undefined, fakeT)
    expect(items).toEqual([])
  })
})

describe('parseSelectedIds', () => {
  it('round-trips a selection through JSON.stringify and back', () => {
    const ids = ['dev-1', 'dev-2']
    expect(parseSelectedIds(JSON.stringify(ids))).toEqual(ids)
  })

  it('treats an empty string as no selection', () => {
    expect(parseSelectedIds('')).toEqual([])
  })

  it('treats malformed JSON as no selection rather than throwing', () => {
    expect(parseSelectedIds('not-json')).toEqual([])
  })

  it('drops non-string entries from a malformed array', () => {
    expect(parseSelectedIds('["dev-1", 42, null]')).toEqual(['dev-1'])
  })
})
