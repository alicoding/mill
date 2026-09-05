import { copy } from '../shared/copy'
import { extensionOf } from './unitRegistry'

// Turning a dropped .json/.yaml/.yml file's TEXT into the value the
// board's json face renders (goal 0269). Pure, so every rule below is
// unit-tested without mounting anything; the tree SHAPE (rows, paths,
// counts, filtering) is shared/jsonTreeModel.ts's, not a second model.

// The extensions this noun claims on drop -- kept identical to
// internal/domain/atlas/mirror.go's textExtensions and its live-watch
// list in the reverse direction, the same "kept identical" discipline
// the sheet and pdf extension sets document.
const JSON_EXTENSIONS = new Set(['.json'])
const YAML_EXTENSIONS = new Set(['.yaml', '.yml'])

export type JsonDocFormat = 'json' | 'yaml'

export function isJsonPath(path: string): boolean {
  const ext = extensionOf(path)
  return JSON_EXTENSIONS.has(ext) || YAML_EXTENSIONS.has(ext)
}

// Which parser a path's bytes go through. A path this noun does not
// claim never reaches here.
export function jsonFormatFor(path: string): JsonDocFormat {
  return YAML_EXTENSIONS.has(extensionOf(path)) ? 'yaml' : 'json'
}

export interface JsonParseError {
  // The parser's own first line, without the multi-line source excerpt
  // the yaml package appends -- that excerpt repeats the file, which is
  // already open in whatever wrote it.
  message: string
  line?: number
  column?: number
}

export type JsonParseResult = { value: unknown } | { error: JsonParseError }

export function isParseError(result: JsonParseResult): result is { error: JsonParseError } {
  return 'error' in result
}

// Async for one reason (the same one tools/sheetNoun.ts states for the
// spreadsheet parsers): the yaml package is dynamically imported, so a
// board with no yaml object on it never loads it, and the routing path
// that only needs isJsonPath above never pulls a parser at all.
export async function parseJsonDocument(text: string, format: JsonDocFormat): Promise<JsonParseResult> {
  return format === 'yaml' ? parseYaml(text) : parseJson(text)
}

// V8 states the position two ways depending on the failure and the
// runtime version: "(line 3 column 6)" when it knows both, else a byte
// "position 16" this resolves against the source itself. Neither is
// guaranteed, so both stay optional on JsonParseError above.
function jsonErrorPosition(message: string, text: string): { line?: number; column?: number } {
  const explicit = /\(line (\d+) column (\d+)\)/.exec(message)
  if (explicit) return { line: Number(explicit[1]), column: Number(explicit[2]) }
  const offset = /position (\d+)/.exec(message)
  if (!offset) return {}
  const before = text.slice(0, Number(offset[1]))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

// The place appears ONCE, in the error's own line/column, so the
// sentence beside it stays the sentence: V8 appends its own
// "in JSON at position N (line L column C)" tail, which the face would
// otherwise render immediately after the same numbers.
function withoutPositionTail(message: string): string {
  return message.replace(/\s*in JSON at position \d+(\s*\(line \d+ column \d+\))?\.?$/, '')
}

function parseJson(text: string): JsonParseResult {
  try {
    return { value: JSON.parse(text) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const at = jsonErrorPosition(message, text)
    return { error: { message: withoutPositionTail(firstLine(message)), ...at } }
  }
}

// Anchors and aliases resolve to their values and comments are dropped:
// toJS() is the yaml package's own resolution, so the face renders the
// document a YAML reader would read, never the source's syntax. `merge:
// true` is opted into for the same reason -- a `<<` merge key is a YAML
// 1.1 extension the 1.2 spec dropped, so without it every compose file
// and CI config on disk would render a literal "<<" member instead of
// the keys it actually merges in.
// Several documents in one file become one record whose members NAME
// them: the tree labels an array row by its index, and "0" says
// nothing about which document it is.
async function parseYaml(text: string): Promise<JsonParseResult> {
  const { parseAllDocuments } = await import('yaml')
  let docs
  try {
    docs = parseAllDocuments(text, { merge: true })
  } catch (err) {
    return { error: { message: firstLine(err instanceof Error ? err.message : String(err)) } }
  }
  for (const doc of docs) {
    const failure = doc.errors[0]
    if (!failure) continue
    const at = failure.linePos?.[0]
    return { error: { message: firstLine(failure.message), line: at?.line, column: at?.col } }
  }
  if (docs.length === 0) return { value: null }
  if (docs.length === 1) return { value: docs[0].toJS() }
  const record: Record<string, unknown> = {}
  docs.forEach((doc, index) => {
    record[copy('atlas:json.documentLabel', { number: index + 1 })] = doc.toJS()
  })
  return { value: record }
}

function firstLine(message: string): string {
  return message.split('\n')[0].trim()
}
