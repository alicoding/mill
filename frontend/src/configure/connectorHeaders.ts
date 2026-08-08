import type { HeaderRow } from './ConnectorForm'

// Split out from ConnectorForm.tsx: two pure functions with no
// component of their own break React Fast Refresh when exported
// alongside a component from the same file (eslint's own
// react-refresh/only-export-components rule caught this directly),
// same reasoning every other pure-helper extraction in this codebase
// already follows (openapiSynth.ts, canvasConstants.ts).
export function headersToRows(headers: { [key: string]: string | undefined } | null | undefined): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([key, value]) => ({ key, value: value ?? '' }))
}

export function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.key.trim() !== '') out[r.key] = r.value
  }
  return Object.keys(out).length > 0 ? out : null
}
