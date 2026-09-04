import { useSyncExternalStore } from 'react'
import { readResolvedTheme, subscribeResolvedTheme } from '../shared/appearance'
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
