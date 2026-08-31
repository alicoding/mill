import { useSyncExternalStore } from 'react'

// Canvas navigation mode (goal 0257): how a scroll gesture moves any
// interactive Mill canvas (the Atlas board, the workflow editor).
// The converged two-mode pattern the major canvas tools share:
//
// - 'trackpad' — scrolling PANS the board (both axes), pinch zooms,
//   ⌘-scroll zooms.
// - 'mouse'    — scrolling ZOOMS, drag pans.
//
// Stored in localStorage, not the settings service: the mode is bound
// to THIS device's pointing hardware, so each device reaching a shared
// Mill keeps its own answer — the same per-device split Appearance's
// theme choice already follows (SettingsView.tsx's storage-rule
// comment), unlike OS-level state that must round-trip through Go.
export type CanvasNavigationMode = 'trackpad' | 'mouse'

const STORAGE_KEY = 'mill-canvas-navigation'
// Same-tab notification: 'storage' events only fire in OTHER tabs, so
// the setter dispatches its own event for the tab that changed it.
const CHANGE_EVENT = 'mill:canvas-navigation-changed'

// Pure decode, unit-testable without a DOM: anything but the exact
// 'mouse' marker -- including null and a corrupted value -- is the
// default.
export function modeFromStored(value: string | null): CanvasNavigationMode {
  return value === 'mouse' ? 'mouse' : 'trackpad'
}

export function getCanvasNavigationMode(): CanvasNavigationMode {
  try {
    return modeFromStored(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'trackpad'
  }
}

export function setCanvasNavigationMode(mode: CanvasNavigationMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage unavailable (private mode): the event below still updates
    // every mounted canvas until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useCanvasNavigationMode(): CanvasNavigationMode {
  return useSyncExternalStore(subscribe, getCanvasNavigationMode)
}

// The ONE place the mode maps to canvas-library props — every canvas
// spreads this bundle, so the two canvases can never drift apart on
// what a mode means. zoomActivationKeyCode 'Meta' makes ⌘-scroll zoom
// in trackpad mode; zoomOnPinch stays on in both modes (a trackpad
// pinch reaches the browser as a ctrl-flagged wheel either way).
export function canvasNavigationProps(mode: CanvasNavigationMode): {
  panOnScroll: boolean
  zoomOnScroll: boolean
  zoomOnPinch: boolean
  zoomActivationKeyCode: string
} {
  return {
    panOnScroll: mode === 'trackpad',
    zoomOnScroll: mode === 'mouse',
    zoomOnPinch: true,
    zoomActivationKeyCode: 'Meta',
  }
}
