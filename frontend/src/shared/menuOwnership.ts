// Exactly one owner per combo (goal 0332). A combo carried by a native
// menu item is intercepted by the menu bar before the keypress reaches
// the page at all, so the in-window keydown dispatcher must not also
// claim it -- and must still claim it where no native menu exists
// (server mode, the browser companion), which is why this set is filled
// by a successful menu install rather than derived from the registry.
//
// Combo keys are shared/keybinding.ts's `comboKey(mods, key)` strings,
// the same vocabulary dispatchCommandForEvent matches against.
let menuOwned: ReadonlySet<string> = new Set<string>()
let menuOwnershipVersion = 0
const menuOwnershipListeners = new Set<() => void>()

export function setMenuOwnedCombos(combos: Iterable<string>): void {
  menuOwned = new Set(combos)
  menuOwnershipVersion += 1
  for (const listener of menuOwnershipListeners) listener()
}

export function isMenuOwnedCombo(combo: string): boolean {
  return menuOwned.has(combo)
}

export function subscribeMenuOwnership(listener: () => void): () => void {
  menuOwnershipListeners.add(listener)
  return () => menuOwnershipListeners.delete(listener)
}

export function menuOwnershipSnapshot(): number {
  return menuOwnershipVersion
}
