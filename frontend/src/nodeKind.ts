import { DownloadIcon, SyncIcon, UploadIcon, type Icon } from '@primer/octicons-react'

// Shared by CompositionCanvas.tsx (canvas node chrome, palette) and
// CompositionView.tsx (node-primitives list, saved-workflow chip chain)
// -- split into its own module rather than co-located with a component
// so Fast Refresh doesn't warn about a non-component export.
//
// Mill's node kinds are Capture/Process/Apply (SPEC.md §2's already-
// locked primitive), not the reference no-code platform's fuller
// Input/Decision/Ruleset/... taxonomy (SPEC.md §3.2/ADR-0005) -- most of
// that taxonomy is real, unbuilt future work (Decision/Ruleset/Parallel
// Steps/etc. don't exist in Mill yet), so the icon/color/title-case
// treatment below is adopted from that reference's card style, but
// applied honestly to what Mill's nodes actually do, not borrowed names
// for capabilities Mill doesn't have.
export const KIND_VARIANT: Record<string, 'accent' | 'success' | 'severe'> = {
  capture: 'accent',
  process: 'success',
  apply: 'severe',
}

export const KIND_LABEL: Record<string, string> = {
  capture: 'Capture',
  process: 'Process',
  apply: 'Apply',
}

// DownloadIcon/SyncIcon/UploadIcon: capture pulls data in, process
// transforms it in place, apply pushes it back out -- the same in/
// transform/out shape the reference's own Input icon (arrow into a box)
// gestures at, expressed with icons that already exist in Mill's
// adopted icon set (@primer/octicons-react, no new dependency).
export const KIND_ICON: Record<string, Icon> = {
  capture: DownloadIcon,
  process: SyncIcon,
  apply: UploadIcon,
}

export const KIND_ICON_BG: Record<string, string> = {
  capture: 'var(--bgColor-accent-emphasis)',
  process: 'var(--bgColor-success-emphasis)',
  apply: 'var(--bgColor-severe-emphasis)',
}
