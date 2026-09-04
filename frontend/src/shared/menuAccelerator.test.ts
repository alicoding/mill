import { describe, expect, it } from 'vitest'
import { toWailsAccelerator } from './menuAccelerator'

// The accelerator strings a native menu item takes are parsed by the
// toolkit's own parser: modifiers by name, '+' as the separator, and a
// key that is either a single printable character or one of its named
// keys. Anything it rejects leaves the item silently unaccelerated, so
// the translation is pinned here rather than discovered on a menu bar.
describe('toWailsAccelerator', () => {
  const cases: [string, { mods: string[]; key: string }, string | null][] = [
    ['⌘W', { mods: ['cmd'], key: 'W' }, 'cmdorctrl+w'],
    ['⌘,', { mods: ['cmd'], key: ',' }, 'cmdorctrl+,'],
    ['⌘0', { mods: ['cmd'], key: '0' }, 'cmdorctrl+0'],
    ['⇧⌘W', { mods: ['cmd', 'shift'], key: 'W' }, 'cmdorctrl+shift+w'],
    ['⌥⌘W', { mods: ['cmd', 'option'], key: 'W' }, 'cmdorctrl+option+w'],
    ['⌃⇧⌘A', { mods: ['ctrl', 'shift', 'cmd'], key: 'A' }, 'cmdorctrl+ctrl+shift+a'],
    ['⌃Tab', { mods: ['ctrl'], key: 'Tab' }, 'ctrl+tab'],
    ['⌘↩', { mods: ['cmd'], key: 'Enter' }, 'cmdorctrl+enter'],
    ['⌘↑', { mods: ['cmd'], key: 'ArrowUp' }, 'cmdorctrl+up'],
    ['⌘←', { mods: ['cmd'], key: 'ArrowLeft' }, 'cmdorctrl+left'],
    ['⌘Space', { mods: ['cmd'], key: 'Space' }, 'cmdorctrl+space'],
    // '+' has to go out by name: the parser splits the string on '+',
    // so a literal plus sign is rejected outright.
    ['⌘+', { mods: ['cmd'], key: '+' }, 'cmdorctrl+plus'],
    ['⌘-', { mods: ['cmd'], key: '-' }, 'cmdorctrl+-'],
    ['⌘/', { mods: ['cmd'], key: '/' }, 'cmdorctrl+/'],
    ['⌘]', { mods: ['cmd'], key: ']' }, 'cmdorctrl+]'],
    // A bare key would fire on plain typing that reaches the menu bar.
    ['bare Delete', { mods: [], key: 'Delete' }, null],
    ['bare G', { mods: [], key: 'G' }, null],
    // A key with no named-key spelling cannot be expressed at all.
    ['⌘F13Extra', { mods: ['cmd'], key: 'Nonsense' }, null],
  ]

  it.each(cases)('%s', (_name, combo, want) => {
    expect(toWailsAccelerator(combo)).toBe(want)
  })
})
