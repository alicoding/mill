// Live theme preview (goal 0342). Pointing at a theme in the picker
// paints the whole window in it before any choice is made; leaving the
// list or pressing Escape puts the committed one back.
//
// Preview is provider state, never a write: it is not persisted and
// never broadcast, so a preview in Settings can never repaint another
// window or survive a reload. That is the whole reason it does not go
// through setAppearance, which exists to do exactly those two things.

import type { ResolvedMode } from './appearance'

export interface ThemePreview {
	family: ResolvedMode
	scheme: string
}

export type PreviewEvent =
	| { kind: 'point'; family: ResolvedMode; scheme: string }
	| { kind: 'leave' }
	| { kind: 'cancel' }
	| { kind: 'commit' }

// previewReducer is the whole state machine: pointing at an item (by
// pointer or by arrow key) previews it, and every way out of the list
// clears it. Commit clears too, because the committed choice is then
// the real appearance and a lingering preview of the same value would
// only be a second source of truth.
export function previewReducer(state: ThemePreview | null, event: PreviewEvent): ThemePreview | null {
	if (event.kind === 'point') {
		if (state !== null && state.family === event.family && state.scheme === event.scheme) return state
		return { family: event.family, scheme: event.scheme }
	}
	return null
}

let current: ThemePreview | null = null
const listeners = new Set<() => void>()

export function getThemePreview(): ThemePreview | null {
	return current
}

export function dispatchThemePreview(event: PreviewEvent): void {
	const next = previewReducer(current, event)
	if (next === current) return
	current = next
	for (const l of listeners) l()
}

export function subscribeThemePreview(onChange: () => void): () => void {
	listeners.add(onChange)
	return () => listeners.delete(onChange)
}

// previewedSchemes applies a preview over the committed pair. The
// preview replaces its own family's scheme only, so previewing a light
// theme while the window is showing dark changes nothing on screen --
// the honest answer, since that theme is not what the window paints.
export function previewedSchemes(
	committed: { lightTheme: string; darkTheme: string },
	preview: ThemePreview | null,
): { lightTheme: string; darkTheme: string } {
	if (preview === null) return committed
	return preview.family === 'dark'
		? { lightTheme: committed.lightTheme, darkTheme: preview.scheme }
		: { lightTheme: preview.scheme, darkTheme: committed.darkTheme }
}
