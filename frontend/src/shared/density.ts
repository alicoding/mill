import { useSyncExternalStore } from 'react'
// Display density (docs/goals/0096): applies the persisted appearance
// preference to a document root as a data attribute, the same
// data-attribute-on-root mechanism App.tsx already uses for color mode.
// Shared by app/App.tsx (main window), app/QuickPanelApp.tsx (the
// Quick Panel's own separate Wails window/document), and
// views/SettingsView.tsx (applies instantly on change, ahead of the
// persist RPC resolving) -- each is a distinct call site needing the
// exact same DOM write.
export type DisplayDensity = 'comfortable' | 'compact'

// Compact sets data-density="compact"; Comfortable removes the
// attribute entirely so every consuming CSS selector needs only one
// [data-density="compact"] override, never a separate comfortable
// branch to keep in sync.
export function applyDensity(value: DisplayDensity, root: HTMLElement = document.documentElement): void {
  if (value === 'compact') root.dataset.density = 'compact'
  else delete root.dataset.density
}

// useDisplayDensity reads the live density for a component that sizes
// itself in JavaScript rather than CSS (the adopted grid's row and
// header heights are props, not styles): the root's data-density
// attribute, observed for changes, so a Settings flip re-renders the
// grid without a reload.
export function useDisplayDensity(): DisplayDensity {
  return useSyncExternalStore(subscribeDensity, readDensity, () => 'comfortable')
}

function readDensity(): DisplayDensity {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable'
}

function subscribeDensity(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
  return () => observer.disconnect()
}
