import { useSyncExternalStore } from 'react'
import { readResolvedTheme, subscribeResolvedTheme, type ResolvedMode } from '../shared/appearance'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { pluginRunState } from './pluginTrust'
import { readPluginPolicy } from './loader'
import {
	acceptPluginTheme,
	buildThemeCss,
	forgetPluginThemes,
	pluginThemeSchemeId,
	rejectPluginTheme,
	validateThemeCss,
} from '../shared/appearanceThemes'

import type { PluginTheme } from './sdk'

// The host half of the plugin theme contract (goal 0320 S3). A plugin's
// face, view or capture is handed the resolved appearance and a change
// feed; the same pair rides its mount root as data-mill-theme /
// data-mill-scheme so plain CSS needs neither.
//
// The feed observes the document root's own attributes rather than the
// appearance store directly, so it fires for every path that repaints:
// a Settings change in this window, one broadcast from another window,
// and the system flipping light/dark or asking for more contrast.

export function currentPluginTheme(): PluginTheme {
  return readResolvedTheme()
}

export function onPluginThemeChange(cb: (theme: PluginTheme) => void): () => void {
  return subscribeResolvedTheme(() => cb(readResolvedTheme()))
}

// pluginThemeAttrs is what a host component spreads onto the element it
// hands the plugin, so a plugin stylesheet can branch on the theme with
// no JavaScript at all.
export function pluginThemeAttrs(theme: PluginTheme): Record<string, string> {
  return { 'data-mill-theme': theme.mode, 'data-mill-scheme': theme.scheme }
}

// usePluginTheme is the host-component read: a cached snapshot, because
// useSyncExternalStore compares snapshots by identity and reading the
// attributes builds a fresh object every call.
let snapshot: PluginTheme = { mode: 'light', scheme: 'light' }

function readSnapshot(): PluginTheme {
  const next = readResolvedTheme()
  if (next.mode !== snapshot.mode || next.scheme !== snapshot.scheme) snapshot = next
  return snapshot
}

export function usePluginTheme(): PluginTheme {
  return useSyncExternalStore(subscribeResolvedTheme, readSnapshot, () => snapshot)
}

// ---------------------------------------------------------------- //
// Contributed themes (goal 0342): the other direction of the same
// contract. A plugin ships a CSS file of documented custom properties;
// the host reads it, refuses anything that is not a flat declaration
// list, layers it over the family's built-in palette and injects the
// result under the theme's own scheme id.
//
// Installed per WINDOW, from AppearanceProvider rather than from the
// plugin loader: the Quick Panel and the tray panel run no plugin code
// at all, and they still have to paint in the theme the user chose.


const STYLE_ATTR = 'data-mill-plugin-theme'

// The family's built-in palette, fetched once per window and only when
// a contributed theme actually needs it. Primer's own functional theme
// files are the source: a contributed theme names a couple of dozen
// tokens, and the several hundred it leaves alone must still resolve.
const bases: Partial<Record<ResolvedMode, Promise<string>>> = {}

function baseCss(family: ResolvedMode): Promise<string> {
	const cached = bases[family]
	if (cached) return cached
	const loading = family === 'dark'
		? import('@primer/primitives/dist/css/functional/themes/dark.css?raw').then((m) => m.default)
		: import('@primer/primitives/dist/css/functional/themes/light.css?raw').then((m) => m.default)
	bases[family] = loading
	return loading
}

function injectThemeStyle(schemeId: string, css: string): void {
	const existing = document.head.querySelector(`style[${STYLE_ATTR}="${CSS.escape(schemeId)}"]`)
	if (existing) existing.remove()
	const style = document.createElement('style')
	style.setAttribute(STYLE_ATTR, schemeId)
	style.textContent = css
	// Appended to head AFTER the bundle's own stylesheets, which is what
	// settles the tie with Primer's rules of the same specificity
	// (app/mill-tokens.css's header carries the whole cascade argument).
	document.head.append(style)
}

export function removePluginThemeStyles(pluginId: string): void {
	for (const style of document.head.querySelectorAll(`style[${STYLE_ATTR}^="${CSS.escape(pluginId)}."]`)) style.remove()
	forgetPluginThemes(pluginId)
}

interface ThemeDecl {
	id: string
	label: string
	family: string
	file: string
}

// installPluginThemes reads every runnable plugin's declared themes.
// Failure is per-theme: an unreadable or unacceptable file leaves that
// one theme out of the picker with a reason, never disturbing the rest.
// It answers false when the plugin list itself could not be read, so a
// caller never mistakes "nothing loaded" for "nothing contributed".
export async function installPluginThemes(): Promise<boolean> {
	let plugins
	try {
		plugins = (await PluginService.ListPlugins()) ?? []
	} catch {
		return false
	}
	const policy = await readPluginPolicy()
	for (const info of plugins) {
		if (info.Error) continue
		const id = info.Manifest.id
		const themes = (info.Manifest.contributes?.themes ?? []) as ThemeDecl[]
		if (themes.length === 0) continue
		const state = pluginRunState(id, !!info.Builtin, policy, { contentHash: info.ContentHash ?? '', signingPolicy: !!info.SigningPolicy, signed: !!info.Signed })
		if (state !== 'run') {
			removePluginThemeStyles(id)
			continue
		}
		for (const theme of themes) await installOneTheme(id, info.Manifest.name || id, info.Manifest.version, theme)
	}
	return true
}

async function installOneTheme(pluginId: string, pluginName: string, version: string, theme: ThemeDecl): Promise<void> {
	const schemeId = pluginThemeSchemeId(pluginId, theme.id)
	const family: ResolvedMode = theme.family === 'dark' ? 'dark' : 'light'
	let declarations: string
	try {
		const res = await fetch(`/plugins/${pluginId}/${theme.file}?v=${encodeURIComponent(version)}`)
		if (!res.ok) throw new Error(String(res.status))
		declarations = await res.text()
	} catch {
		rejectPluginTheme({ schemeId, pluginName, label: theme.label, line: 0 })
		return
	}
	const refusal = validateThemeCss(declarations)
	if (refusal) {
		rejectPluginTheme({ schemeId, pluginName, label: theme.label, line: refusal.line })
		return
	}
	injectThemeStyle(schemeId, buildThemeCss(await baseCss(family), family, schemeId, declarations))
	acceptPluginTheme({ schemeId, pluginId, pluginName, label: theme.label, family })
}
