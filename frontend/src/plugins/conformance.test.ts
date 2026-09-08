import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MillPluginAPI, PluginModule } from './sdk'
import type { Manifest as RealManifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { settingDeclsFromManifest } from './pluginSettings'
import { resolveMenus } from './pluginMenus'

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
  contributes?: {
    canvasObjects?: { kind: string }[]
    views?: { id: string }[]
    settings?: { key: string }[]
    configuration?: { key: string }[]
    captures?: { id: string }[]
    commands?: { id: string }[]
    tools?: { name: string; run?: { kind?: string; commandId?: string } }[]
  }
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
    content: { createNote: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, createCard: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, updateCard: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, appendListRow: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } }, createList: async () => { touched.add('content'); return { approved: false, effect: 'deny' as const, ruleLabel: '', id: '' } } },
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
    const registered = { objects: [] as string[], views: [] as string[], captures: [] as string[], commands: [] as string[] }
    const touched = new Set<string>()
    const api = recordingAPI(manifest, touched)
    const spy = {
      ...api,
      registerCanvasObject: (decl: { kind: string }) => { registered.objects.push(decl.kind); touched.add('registerCanvasObject') },
      registerView: (decl: { id: string }) => { registered.views.push(decl.id); touched.add('registerView') },
      registerCapture: (decl: { id: string }) => { registered.captures.push(decl.id); touched.add('registerCapture') },
      registerCommand: (decl: { id: string }) => { registered.commands.push(decl.id); touched.add('registerCommand') },
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
    // A tool that runs a command is only reachable if the plugin
    // actually registers that command -- the half only a JS host can
    // check, since the manifest alone cannot say what activate() did.
    const declaredCommands = (manifest.contributes?.commands ?? []).map((c) => c.id)
    for (const command of registered.commands) {
      if (declaredCommands.length > 0) expect(declaredCommands, `command "${command}" is declared`).toContain(command)
    }
    for (const tool of manifest.contributes?.tools ?? []) {
      if (tool.run?.kind !== 'command') continue
      expect(registered.commands, `tool "${tool.name}" runs a command main.js registers`).toContain(tool.run.commandId)
    }

    // configuration (goal 0349 S2) is canonical; settings is the
    // deprecated alias -- pluginsvc already refused a manifest
    // declaring both, so this never has to merge conflicting lists.
    const declaredSettings = (manifest.contributes?.configuration ?? manifest.contributes?.settings ?? []).map((s) => s.key)
    for (const door of touched) {
      const m = /^settings\.(get|onChange):(.+)$/.exec(door)
      if (m) expect(declaredSettings, `setting "${m[2]}" is declared`).toContain(m[2])
    }
    // A larger example's main.js (e.g. one bundling a diagram/markmap
    // renderer) costs more to transform on first dynamic import than
    // vitest's 5s default budgets for -- scale with example count/size,
    // never assume the default is enough.
  }, 20000)
})

// The VS Code recognisability contract's frontend half (goal 0349 S2):
// settingDeclsFromManifest and resolveMenus are the two functions a
// ported manifest actually flows through, so the fixtures below drive
// THEM rather than re-deriving the rule inline.
function fixtureManifest(contributes: Partial<RealManifest['contributes']>): RealManifest {
  return {
    id: 'demo', name: 'Demo', version: '1.0.0', description: '', author: '', minMillVersion: '', icon: 'icon.png', capabilities: null,
    contributes: {
      canvasObjects: null, steps: null, captures: null, settings: null, configuration: null, menus: null,
      network: null, views: null, commands: null, themes: null, secretSources: null, tools: null, mcpServers: null,
      ...contributes,
    },
  }
}

describe('the VS Code recognisability contract (goal 0349 S2)', () => {
  const apiKeySetting = { key: 'apiKey', type: 'string' as const, label: 'API key', description: 'd', default: 'x', options: null, min: null, max: null }

  it('reads configuration when it is the only key declared', () => {
    const decls = settingDeclsFromManifest(fixtureManifest({ configuration: [apiKeySetting] }))
    expect(decls.map((d) => d.key)).toEqual(['apiKey'])
  })

  it('falls back to the deprecated settings alias when configuration is absent', () => {
    const decls = settingDeclsFromManifest(fixtureManifest({ settings: [apiKeySetting] }))
    expect(decls.map((d) => d.key)).toEqual(['apiKey'])
  })

  it('prefers configuration over settings when a manifest somehow carries both', () => {
    // pluginsvc refuses this manifest at load; the frontend resolver
    // still needs a deterministic answer for any caller that bypassed
    // the loader (a hand-built fixture, a future direct construction).
    const decls = settingDeclsFromManifest(fixtureManifest({ configuration: [apiKeySetting], settings: [{ ...apiKeySetting, key: 'legacyKey' }] }))
    expect(decls.map((d) => d.key)).toEqual(['apiKey'])
  })

  it('lands a recognised contributes.menus entry on its Mill seat', () => {
    const { seated, unknownMenuIds } = resolveMenus({
      commandPalette: [{ command: 'demo.palette', when: '', group: '' }],
      'editor/context': [{ command: 'demo.context', when: 'boardSelection', group: '1_actions' }],
      'view/title': [{ command: 'demo.title', when: '', group: '' }],
    })
    expect(seated).toEqual([
      { command: 'demo.palette', seat: 'commandPalette', when: undefined, group: undefined },
      { command: 'demo.context', seat: 'canvasContextMenu', when: 'boardSelection', group: '1_actions' },
      { command: 'demo.title', seat: 'viewTitle', when: undefined, group: undefined },
    ])
    expect(unknownMenuIds).toEqual([])
  })

  it('ignores a menu id Mill has no seat for and names it as unknown', () => {
    const { seated, unknownMenuIds } = resolveMenus({ 'scm/title': [{ command: 'demo.scm', when: '', group: '' }] })
    expect(seated).toEqual([])
    expect(unknownMenuIds).toEqual(['scm/title'])
  })
})
