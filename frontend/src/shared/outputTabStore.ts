import type { OutputShape } from './outputShape'

// "Open in full" (goal 0326): the same viewer, in its own work tab,
// when a panel is too small for the output it holds.
//
// The payload is held HERE, keyed by id, and the tab carries only that
// id: a work tab is persisted state, and a megabyte of a run's stdout
// has no business in localStorage. That also settles restore -- an
// output tab is not restorable (workTabs.ts's isRestorable), because
// the payload it points at is a run's answer at a moment, not an
// entity that still exists after a relaunch.

export interface StashedOutput {
  id: string
  title: string
  value: unknown
  shape?: OutputShape
  mime?: string
  site: string
}

const stash = new Map<string, StashedOutput>()
let seq = 0

export function stashOutput(entry: Omit<StashedOutput, 'id'>): string {
  seq += 1
  const id = `output-${seq}`
  stash.set(id, { ...entry, id })
  return id
}

export function readStashedOutput(id: string): StashedOutput | undefined {
  return stash.get(id)
}

export function dropStashedOutput(id: string): void {
  stash.delete(id)
}
