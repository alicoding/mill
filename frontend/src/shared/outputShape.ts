// What a piece of output IS, and which views can render it (goal
// 0326). Output is PRESENTED, never typed: a producer declares the
// shape it emits and the viewer renders it, exactly as a notebook's
// MIME bundle lets the producer offer a representation and the
// renderer pick the richest one. Structural inference is the FALLBACK,
// for an untyped string only, and the viewer says so ("Detected as").
//
// Pure: no React, no DOM. shared/OutputViewer.tsx and its view
// components are the only consumers, and every rule below is unit
// tested directly.

export type OutputShape = 'json' | 'rows' | 'text' | 'html' | 'markdown' | 'error' | 'binary'

export type OutputView = 'tree' | 'table' | 'raw' | 'log' | 'rendered' | 'source' | 'error' | 'media'

// The first view of each shape's list is its default; the rest are the
// alternates the segmented control offers. 'table' is appended to a
// json shape only when the value is actually an array of objects, so
// the switch never offers a view that would render nothing.
const VIEWS: Record<OutputShape, OutputView[]> = {
  json: ['tree', 'raw'],
  rows: ['table', 'tree', 'raw'],
  text: ['log', 'raw'],
  html: ['rendered', 'source'],
  markdown: ['rendered', 'source'],
  error: ['error', 'raw'],
  binary: ['media'],
}

// Locale keys, resolved by whoever renders the switch. Kept here, next
// to the union they label, so a new view cannot ship unlabelled.
export const VIEW_LABEL_KEY: Record<OutputView, string> = {
  tree: 'output.view.tree',
  table: 'output.view.table',
  raw: 'output.view.raw',
  log: 'output.view.log',
  rendered: 'output.view.rendered',
  source: 'output.view.source',
  error: 'output.view.error',
  media: 'output.view.media',
}

// Render budget. A run's stdout or a large API response is routinely
// bigger than any panel can usefully paint, so the viewer renders the
// first slice and says what it held back, rather than freezing on a
// megabyte of text.
export const CAP_BYTES = 256 * 1024
export const CAP_ROWS = 500

// eslint-disable-next-line no-control-regex -- ESC is literally what an ANSI sequence starts with
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/

export function hasAnsi(text: string): boolean {
  return ANSI_PATTERN.test(text)
}

// The text a view copies, and the text every structural check reads.
// An object value is pretty-printed once, here, so no caller has to
// decide how output becomes a string.
export function outputText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface ParsedJson {
  ok: boolean
  value: unknown
}

export function parseJson(text: string): ParsedJson {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, value: null }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false, value: null }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// An array of objects is table-shaped. A ragged array (objects with
// different keys) still is: the union of keys is the column set, the
// same rule a spreadsheet import applies.
export function isRowShaped(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject)
}

export interface TableData {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number
  truncated: boolean
}

export function tableFrom(value: unknown, cap = CAP_ROWS): TableData | null {
  if (!isRowShaped(value)) return null
  const all = value as Record<string, unknown>[]
  const columns: string[] = []
  for (const row of all) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
  }
  return { columns, rows: all.slice(0, cap), total: all.length, truncated: all.length > cap }
}

// Content-Type to shape. Parameters are dropped (`application/json;
// charset=utf-8`), and any `+json` suffix type counts as JSON, which is
// what the media-type suffix registry means by it.
export function shapeFromMime(mime: string | undefined): OutputShape | null {
  if (!mime) return null
  const type = mime.split(';')[0].trim().toLowerCase()
  if (type === '') return null
  if (type === 'application/json' || type.endsWith('+json')) return 'json'
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown'
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) return 'binary'
  if (type.startsWith('text/')) return 'text'
  return 'binary'
}

// The fallback, for a string whose producer declared nothing. Order
// matters: a JSON document that happens to start with `<` is not HTML,
// so parseability is asked first.
export function inferShape(text: string): OutputShape {
  const trimmed = text.trim()
  if (trimmed === '') return 'text'
  const first = trimmed[0]
  if (first === '{' || first === '[') {
    const parsed = parseJson(trimmed)
    if (parsed.ok) return isRowShaped(parsed.value) ? 'rows' : 'json'
  }
  if (/^<(!doctype html|html|body|div|p|table|ul|ol|h[1-6])\b/i.test(trimmed)) return 'html'
  return 'text'
}

export interface ResolvedShape {
  shape: OutputShape
  // Whether the shape came from inference rather than a declaration --
  // the viewer says "Detected as …" only in that case, so a declared
  // shape never claims to have been guessed.
  detected: boolean
  views: OutputView[]
  // The parsed value behind a json/rows shape, or null when the
  // declared shape did not parse (the viewer falls back to Raw and
  // says why).
  parsed: unknown
  parseFailed: boolean
}

export interface ResolveInput {
  value: unknown
  shape?: OutputShape
  mime?: string
}

// Which shape applies, and whether it was declared or guessed. A
// non-string value is structured by construction, so nothing about it
// was inferred from bytes.
function effectiveShape(value: unknown, declared: OutputShape | undefined, text: string): { shape: OutputShape; detected: boolean } {
  if (declared) return { shape: declared, detected: false }
  if (typeof value === 'object' && value !== null) return { shape: isRowShaped(value) ? 'rows' : 'json', detected: false }
  return { shape: inferShape(text), detected: true }
}

// The structured value a json/rows view walks: the object itself when
// the producer handed one over, otherwise the parse of its text.
function structuredValue(value: unknown, text: string): { parsed: unknown; parseFailed: boolean } {
  if (typeof value === 'object' && value !== null) return { parsed: value, parseFailed: false }
  const result = parseJson(text)
  return result.ok ? { parsed: result.value, parseFailed: false } : { parsed: null, parseFailed: true }
}

// Table is offered only for an actual array of objects, and a declared
// `rows` value that turns out not to be one falls back to the tree
// rather than rendering an empty table.
function viewsFor(shape: OutputShape, parsed: unknown): OutputView[] {
  if (shape === 'json' && isRowShaped(parsed)) return ['tree', 'table', 'raw']
  if (shape === 'rows' && !isRowShaped(parsed)) return ['tree', 'raw']
  return [...VIEWS[shape]]
}

export function resolveShape({ value, shape, mime }: ResolveInput): ResolvedShape {
  const text = outputText(value)
  const { shape: effective, detected } = effectiveShape(value, shape ?? shapeFromMime(mime) ?? undefined, text)
  const structured = effective === 'json' || effective === 'rows'
  const { parsed, parseFailed } = structured ? structuredValue(value, text) : { parsed: null, parseFailed: false }
  if (parseFailed) return { shape: effective, detected, views: ['raw'], parsed: null, parseFailed }
  return { shape: effective, detected, views: viewsFor(effective, parsed), parsed, parseFailed }
}

export interface CappedText {
  text: string
  truncated: boolean
  total: number
}

export function capText(text: string, cap = CAP_BYTES): CappedText {
  if (text.length <= cap) return { text, truncated: false, total: text.length }
  return { text: text.slice(0, cap), truncated: true, total: text.length }
}

// An error's message is its first line; everything after it is the
// trace, behind the Details disclosure. A single-line error has no
// details and the disclosure is not offered.
export interface ErrorParts {
  message: string
  details: string
}

export function errorParts(text: string): ErrorParts {
  const newline = text.indexOf('\n')
  if (newline === -1) return { message: text.trim(), details: '' }
  return { message: text.slice(0, newline).trim(), details: text.slice(newline + 1).trim() }
}

// Per-site view choice, remembered for the session only: a preference
// that outlives the window would be a setting, and this is not one.
const STORE_PREFIX = 'mill.output.'

export function readStoredView(site: string, views: OutputView[]): OutputView | null {
  try {
    const stored = sessionStorage.getItem(STORE_PREFIX + site)
    return stored && views.includes(stored as OutputView) ? (stored as OutputView) : null
  } catch {
    return null
  }
}

export function writeStoredView(site: string, view: OutputView): void {
  try {
    sessionStorage.setItem(STORE_PREFIX + site, view)
  } catch {
    // Per-device convenience only.
  }
}

// Case-insensitive match offsets, so a view can wrap the hits without
// each one re-implementing the scan.
export function findMatches(text: string, query: string): number[] {
  if (query === '') return []
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: number[] = []
  let at = hay.indexOf(needle)
  while (at !== -1) {
    out.push(at)
    at = hay.indexOf(needle, at + needle.length)
  }
  return out
}
