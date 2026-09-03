import { describe, expect, it } from 'vitest'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { linkPasteClaimants } from './linkPasteClaimants'

function plugin(id: string, kinds: { kind: string; pastesURLs?: boolean }[], error = ''): PluginInfo {
  return { Manifest: { id, name: `${id} name`, contributes: { canvasObjects: kinds } }, Error: error } as unknown as PluginInfo
}

describe('linkPasteClaimants', () => {
  it('lists enabled, loadable link claimants once each in plugin order, labelled by the registered tool', () => {
    const plugins = [
      plugin('mill-archive', [{ kind: 'archive', pastesURLs: true }], 'broken'),
      plugin('mill-bookmark', [{ kind: 'bookmark', pastesURLs: true }, { kind: 'bookmark', pastesURLs: true }]),
      plugin('mill-clipper', [{ kind: 'clip', pastesURLs: true }]),
      plugin('mill-scribble', [{ kind: 'ink' }]),
    ]
    const got = linkPasteClaimants(plugins, ['mill-clipper'], (kind) => (kind === 'bookmark' ? 'Bookmark' : undefined))
    expect(got).toEqual([{ kind: 'bookmark', label: 'Bookmark' }])
    // The plugin's name stands in for a tool that never registered.
    expect(linkPasteClaimants(plugins, [], () => undefined).map((c) => c.label)).toEqual(['mill-bookmark name', 'mill-clipper name'])
  })
})
