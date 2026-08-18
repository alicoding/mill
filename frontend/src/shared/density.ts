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
