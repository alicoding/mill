import type { Environment, Variable } from '../../bindings/github.com/alicoding/mill/internal/domain/environment/models'

// Pure helpers for the Environment form's variable rows and its list
// line -- split out of ConfigureEnvironments.tsx for the same two
// reasons execEnvRows.ts documents: pure functions exported alongside a
// component break React Fast Refresh, and pure logic gets a Vitest unit
// test (.claude/rules/testing.md).

export interface VarRow {
  key: string
  value: string
  secret: boolean
}

// varsToRows always yields at least one row, so an empty environment
// opens on an editable line rather than an empty panel.
export function varsToRows(vars: Variable[] | null | undefined): VarRow[] {
  const rows = (vars ?? []).map((v) => ({ key: v.Key, value: v.Value, secret: v.Secret }))
  return rows.length > 0 ? rows : [{ key: '', value: '', secret: false }]
}

// rowsToVars drops rows with no name (an abandoned blank row is not an
// error) and trims the name only -- a value's own whitespace is part of
// what gets substituted.
export function rowsToVars(rows: VarRow[]): Variable[] {
  return rows
    .filter((r) => r.key.trim() !== '')
    .map((r) => ({ Key: r.key.trim(), Value: r.value, Secret: r.secret }))
}

// KEY_PATTERN mirrors the server's own grammar (internal/domain/
// environment). Checked here too so a bad name is caught while typing,
// never only on save.
export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key)
}

// countsFor is the row's own summary: how many variables, and how many
// of them are secret-backed.
export function countsFor(env: Environment): { total: number; secret: number } {
  const vars = env.Vars ?? []
  return { total: vars.length, secret: vars.filter((v) => v.Secret).length }
}

// needsValueCount is how many secret variables have no store reference
// yet -- the one state that makes an otherwise-complete environment
// fail a run.
export function needsValueCount(env: Environment): number {
  return (env.Vars ?? []).filter((v) => v.Secret && v.Value.trim() === '').length
}
