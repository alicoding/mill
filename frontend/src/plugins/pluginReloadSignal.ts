import { useSyncExternalStore } from 'react'

// The reload signal (goal 0319): a reloaded plugin re-registers its
// contributions, which replaces the render callbacks any already-
// mounted face or view is still holding. Hosts read this counter so
// the surfaces on screen re-render from the fresh module instead of
// waiting for the next unrelated re-render.
//
// Deliberately NOT part of PluginEventMap: the public plugin event
// surface is what a PLUGIN subscribes to, and a plugin never observes
// its own reload -- its module is replaced by it.
let version = 0
const listeners = new Set<() => void>()

export function notifyPluginReloaded(): void {
	version++
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => { listeners.delete(listener) }
}

function snapshot(): number {
	return version
}

// usePluginReloadVersion re-renders its host on every plugin reload.
// The value itself is meaningless -- it is a change signal, and hosts
// resolve what they need from the registries during that render.
export function usePluginReloadVersion(): number {
	return useSyncExternalStore(subscribe, snapshot, snapshot)
}
