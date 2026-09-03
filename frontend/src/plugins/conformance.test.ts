import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MillPluginAPI, PluginModule } from './sdk'

// The conformance half of the platform contract (ADR-0051) that only a
// JavaScript host can check: activate every shipped example against a
// recording fake of the api object and assert declare-first parity --
// each canvas object registered is declared in contributes.canvasObjects,
// each view registered is declared in contributes.views, each setting
// read at activate is a declared setting, and no door outside the
// SDK's frozen shape is reached. The same suite an author runs
// (`npm run plugin:conform`) is the one the repo's own examples pass.

const EXAMPLES = path.resolve(__dirname, '../../../examples/plugins')

interface Manifest {
  id: string
  capabilities?: string[]
  contributes?: { canvasObjects?: { kind: string }[]; views?: { id: string }[]; settings?: { key: string }[]; captures?: { id: string }[] }
}

function recordingAPI(manifest: Manifest, touched: Set<string>): MillPluginAPI {
  const noop = () => undefined
  const record = (door: string) => (...args: unknown[]) => { touched.add(door); return args }
  const api = {
    millVersion: '99.0.0',
    pluginId: manifest.id,
    registerCanvasObject: record('registerCanvasObject'),
    registerCommand: record('registerCommand'),
    registerView: record('registerView'),
    registerCapture: record('registerCapture'),
    requestGuardedAction: async () => { touched.add('requestGuardedAction'); return { approved: false, effect: 'deny' as const, ruleLabel: '', performed: false } },
    settings: { get: (key: string) => { touched.add(`settings.get:${key}`); return '' }, onChange: (key: string) => { touched.add(`settings.onChange:${key}`); return noop } },
    notify: () => { touched.add('notify'); return noop },
    storage: { get: async () => { touched.add('storage'); return null }, set: async () => { touched.add('storage') }, delete: async () => { touched.add('storage') }, keys: async () => { touched.add('storage'); return [] } },
    query: async () => { touched.add('query'); return [] },
    on: () => { touched.add('on'); return noop },
    fetch: async () => { touched.add('fetch'); return { approved: false, effect: 'deny' as const, ruleLabel: '', status: 0, headers: {}, body: '' } },
    content: { createNote: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, createCard: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, updateCard: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, appendListRow: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } } },
    convert: { htmlToMarkdown: async (html: string) => { touched.add('convert'); return html } },
    files: { list: async () => { touched.add('files'); return { approved: false, effect: 'deny' as const, ruleLabel: '', entries: [] } } },
  }
  return Object.freeze(api) as unknown as MillPluginAPI
}

const examples = readdirSync(EXAMPLES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

describe('every shipped example plugin conforms to the platform contract', () => {
  it.each(examples)('%s registers only what its manifest declares', async (id) => {
    const dir = path.join(EXAMPLES, id)
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
    const registered = { objects: [] as string[], views: [] as string[], captures: [] as string[] }
    const touched = new Set<string>()
    const api = recordingAPI(manifest, touched)
    const spy = {
      ...api,
      registerCanvasObject: (decl: { kind: string }) => { registered.objects.push(decl.kind); touched.add('registerCanvasObject') },
      registerView: (decl: { id: string }) => { registered.views.push(decl.id); touched.add('registerView') },
      registerCapture: (decl: { id: string }) => { registered.captures.push(decl.id); touched.add('registerCapture') },
    }
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'main.js')).href)) as PluginModule
    const activate = mod.activate ?? (typeof mod.default === 'function' ? mod.default : mod.default?.activate)
    expect(activate, 'main.js exports activate').toBeTypeOf('function')
    await activate!(Object.freeze(spy) as unknown as MillPluginAPI)

    const declaredObjects = (manifest.contributes?.canvasObjects ?? []).map((c) => c.kind)
    for (const kind of registered.objects) expect(declaredObjects, `canvas object "${kind}" is declared`).toContain(kind)
    const declaredViews = (manifest.contributes?.views ?? []).map((v) => v.id)
    for (const view of registered.views) expect(declaredViews, `view "${view}" is declared`).toContain(view)
    const declaredCaptures = (manifest.contributes?.captures ?? []).map((c) => c.id)
    for (const capture of registered.captures) expect(declaredCaptures, `capture "${capture}" is declared`).toContain(capture)
    const declaredSettings = (manifest.contributes?.settings ?? []).map((s) => s.key)
    for (const door of touched) {
      const m = /^settings\.(get|onChange):(.+)$/.exec(door)
      if (m) expect(declaredSettings, `setting "${m[2]}" is declared`).toContain(m[2])
    }
  })
})
