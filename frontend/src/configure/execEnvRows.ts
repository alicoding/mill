// Pure helpers for the ExecEnv form's key/value environment-variable
// rows -- split out from ConfigureExecEnv.tsx for the same two reasons
// requestHeaders.ts documents: pure functions exported alongside a
// component break React Fast Refresh, and pure parsing logic gets a
// Vitest unit test (.claude/rules/testing.md).
//
// The wire shape stays `[]string` of KEY=VALUE (execenv.ExecEnv.Env,
// exactly what procexec feeds exec.Cmd.Env) -- only the editing UI is
// paired rows, so nothing changes server-side.

export interface EnvRow {
  key: string
  value: string
}

// envToRows splits each stored KEY=VALUE entry at the FIRST '=' --- a
// value may itself contain '=' (PATH-like lists never do, but e.g. a
// base64 token can). An entry with no '=' becomes a key with an empty
// value rather than being dropped, so legacy/hand-imported data stays
// visible and editable instead of silently vanishing from the form.
export function envToRows(env: string[] | null | undefined): EnvRow[] {
  const rows = (env ?? []).map((entry) => {
    const i = entry.indexOf('=')
    if (i === -1) return { key: entry, value: '' }
    return { key: entry.slice(0, i), value: entry.slice(i + 1) }
  })
  return rows.length > 0 ? rows : [{ key: '', value: '' }]
}

// rowsToEnv joins rows back into KEY=VALUE entries, skipping rows with
// an empty key (an abandoned blank row is not an error).
export function rowsToEnv(rows: EnvRow[]): string[] {
  return rows
    .filter((r) => r.key.trim() !== '')
    .map((r) => `${r.key.trim()}=${r.value}`)
}
