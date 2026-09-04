import type { Command } from './commands'
import type { MenuPath } from './menuSkeleton'

// Seats a whole command family in one menu band, keeping the family's
// own declared order. Used where a satellite command file IS the band
// (shared/saveCommands.ts, shared/canvasCommands.ts, the Atlas board and
// create families), so the band's membership stays a single decision in
// shared/commands.ts next to the spread it applies to, rather than a
// per-entry number repeated down each file.
export function withMenuGroup(path: MenuPath, group: number, commands: Command[]): Command[] {
  return commands.map((command, order) => ({ ...command, menu: { path, group, order } }))
}
