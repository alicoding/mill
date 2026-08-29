// Plugin-contributed palette commands, collected here during plugin
// activation (which runs BEFORE the app module graph evaluates -- the
// loader's own boot-order contract, main.tsx) and drained by
// shared/commands.ts at ITS module eval. This indirection exists so
// the loader never transitively imports the command module (whose own
// imports evaluate the ATLAS_TOOLS snapshot -- pulling that forward
// would freeze the tool list before any plugin had registered).
export interface RuntimeCommandDecl {
  id: string
  label: string
  run: () => void
}

const collected: RuntimeCommandDecl[] = []

export function collectPluginCommand(decl: RuntimeCommandDecl): void {
  if (collected.some((c) => c.id === decl.id)) {
    throw new Error(`plugin command "${decl.id}" is already registered`)
  }
  collected.push(decl)
}

export function drainedPluginCommands(): RuntimeCommandDecl[] {
  return [...collected]
}
