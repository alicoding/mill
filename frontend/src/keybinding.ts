// Physical-key-position based, so the recorder doesn't care about Shift state.
// event.code is "KeyM" / "Digit1" / "Space" — this strips the prefix.
export function keyFromEventCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  return null
}

export function modsFromEvent(e: KeyboardEvent): string[] {
  const mods: string[] = []
  if (e.metaKey) mods.push('cmd')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('option')
  return mods
}
