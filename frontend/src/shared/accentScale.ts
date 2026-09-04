// Mill's accent scale, derived from the operating system's own accent
// color (goal 0320 S4). Mill offers no color picker of its own: the
// accent is the one the user already chose for their desktop, and when
// the platform reports none the built-in teal stands unchanged.
//
// The derivation keeps the OS accent's hue and saturation and pins the
// LIGHTNESS to the steps mill-tokens.css already uses, so every derived
// value inherits that file's audited contrast behaviour rather than
// whatever an arbitrary accent would land on: a fill dark enough for
// white content on top of it, separate from a text color light enough
// against the dark page behind it.

export interface AccentScale {
  emphasis: string
  fg: string
  muted: string
  borderMuted: string
}

// The built-in teal, and the source of the lightness steps below. Kept
// as the literal answer for "the platform reports no accent" so that
// path is byte-identical to the pre-accent look.
const TEAL_LIGHT: AccentScale = {
  emphasis: '#1F6F6B',
  fg: '#1F6F6B',
  muted: '#DAF3F1',
  borderMuted: '#4FB3AC66',
}
const TEAL_DARK: AccentScale = {
  emphasis: '#2B7D77',
  fg: '#3FA39E',
  muted: '#3FA39E1a',
  borderMuted: '#3FA39E66',
}

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }

// parseAccent accepts the two shapes the platform seam can produce:
// the runtime's own "rgb(r,g,b)" string, and a hex literal. Anything
// else -- including the empty string server mode returns -- is null,
// which is the caller's signal to keep the built-in teal.
export function parseAccent(raw: string): RGB | null {
  const s = raw.trim()
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s)
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    if (r > 255 || g > 255 || b > 255) return null
    return { r, g, b }
  }
  const hex = /^#([0-9a-fA-F]{6})$/.exec(s)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const short = /^#([0-9a-fA-F]{3})$/.exec(s)
  if (short) {
    const [a, c, d] = short[1].split('')
    return { r: parseInt(a + a, 16), g: parseInt(c + c, 16), b: parseInt(d + d, 16) }
  }
  return null
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

export function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(((h % 360) + 360) % 360 / 60)
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ]
  const [r, g, b] = table[seg]
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function hexOf(v: string): string {
  return v.slice(0, 7)
}

// The lightness steps, measured from the built-in teal itself rather
// than typed in as numbers, so the teal stays the scale's definition
// and a change to it moves every derived accent with it.
const STEP = {
  lightEmphasis: rgbToHsl(parseAccent(hexOf(TEAL_LIGHT.emphasis))!).l,
  lightMuted: rgbToHsl(parseAccent(hexOf(TEAL_LIGHT.muted))!).l,
  lightBorder: rgbToHsl(parseAccent(hexOf(TEAL_LIGHT.borderMuted))!).l,
  darkEmphasis: rgbToHsl(parseAccent(hexOf(TEAL_DARK.emphasis))!).l,
  darkFg: rgbToHsl(parseAccent(hexOf(TEAL_DARK.fg))!).l,
}

// accentScale derives one mode's four values from the OS accent. An
// unreadable or absent accent returns the built-in teal for that mode.
export function accentScale(raw: string, mode: 'light' | 'dark'): AccentScale {
  const rgb = parseAccent(raw)
  if (!rgb) return mode === 'dark' ? TEAL_DARK : TEAL_LIGHT
  const { h, s } = rgbToHsl(rgb)
  const at = (l: number) => hslToHex({ h, s, l })
  if (mode === 'dark') {
    const fg = at(STEP.darkFg)
    return { emphasis: at(STEP.darkEmphasis), fg, muted: `${fg}1a`, borderMuted: `${fg}66` }
  }
  const emphasis = at(STEP.lightEmphasis)
  return { emphasis, fg: emphasis, muted: at(STEP.lightMuted), borderMuted: `${at(STEP.lightBorder)}66` }
}

// accentStyleText renders the derived scale as the stylesheet Mill
// injects last. It repeats mill-tokens.css's selector pair exactly --
// the resolved light/dark answer, at the two-attribute specificity that
// file's header explains -- so one rule per mode covers every color
// scheme and still settles the cascade.
export function accentStyleText(raw: string): string {
  const vars = (a: AccentScale) => [
    `--mill-accent-emphasis: ${a.emphasis};`,
    `--mill-accent-fg: ${a.fg};`,
    `--mill-accent-muted: ${a.muted};`,
    `--mill-accent-border-muted: ${a.borderMuted};`,
  ].join(' ')
  return [
    `:root, [data-mill-theme="light"][data-mill-scheme] { ${vars(accentScale(raw, 'light'))} }`,
    `[data-mill-theme="dark"][data-mill-scheme] { ${vars(accentScale(raw, 'dark'))} }`,
  ].join('\n')
}

// applyAccent installs (or refreshes) that stylesheet. One element per
// document, appended last so its rules settle every cascade tie.
export function applyAccent(raw: string, doc: Document = document): void {
  const id = 'mill-accent-scale'
  let el = doc.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = doc.createElement('style')
    el.id = id
    doc.head.append(el)
  }
  el.textContent = accentStyleText(raw)
}
