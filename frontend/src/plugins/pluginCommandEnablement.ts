import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { factsNow } from './pluginMenuFacts'
import { evaluateWhen } from './whenClause'

// Command enablement is declared on contributes.commands. Menu `when`
// clauses remain local to the seat carrying them and never affect this
// global predicate.
export function commandIsEnabled(manifest: Manifest, commandId: string, registered?: () => boolean): boolean {
  const expression = manifest.contributes?.commands?.find((command) => command.id === commandId)?.enablement?.trim()
  const declarative = !expression || evaluateWhen(expression, factsNow(manifest.id))
  return declarative && (registered?.() ?? true)
}

export function commandHasEnablement(manifest: Manifest, commandId: string, registered?: () => boolean): boolean {
  const expression = manifest.contributes?.commands?.find((command) => command.id === commandId)?.enablement?.trim()
  return !!expression || registered !== undefined
}
