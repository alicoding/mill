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
  // pluginId owns the entry: a per-plugin reload (goal 0319) drops
  // exactly what one plugin contributed and re-collects it from the
  // fresh module. Not derivable from `id` -- a plugin's canvas tool
  // registers as atlas.create.<kind>, which carries no plugin name.
  pluginId: string
  run: () => void
  // surface scopes the command to a view the way Command.surface does
  // (docs/goals/0251 audit rider: a plugin object's own create
  // command belongs to the atlas surface, exactly like the built-in
  // tools' atlas.create.<id> commands) -- omitted means global.
  surface?: import('../shared/commands').Command['surface']
  // enabled mirrors Command.enabled (goal 0258 slice 1): a plugin
  // command's own "when" clause, honored by the palette and dispatch
  // exactly like a built-in's.
  enabled?: () => boolean
  // menu mirrors Command.menu (goal 0335), read off the manifest's own
  // contributes.commands[].menu declaration by hostApi.ts's
  // registerCommand -- a plugin has no Command.run() at manifest-parse
  // time for the host to seat directly, so the seat is declared
  // separately and joined here by matching id.
  menu?: import('../shared/commands').Command['menu']
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

// unregisterPluginCommands drops every command one plugin contributed,
// so its next activation can re-collect them without colliding with
// its own previous registration (goal 0319's per-plugin reload).
export function unregisterPluginCommands(pluginId: string): void {
  for (let i = collected.length - 1; i >= 0; i--) {
    if (collected[i].pluginId === pluginId) collected.splice(i, 1)
  }
}
