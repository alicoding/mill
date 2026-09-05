import type { Command } from './commands'
import { entityContext } from './commandContext'
import { ConfigureService } from './bindings'
import { useAppStore } from './store'
import { useConfigureEntityStore, refreshClientCerts } from './configureEntityStore'
import { useUISignalStore } from './uiSignalStore'
import { useUndoDeleteStore } from './undoDeleteStore'
import { copy } from './copy'

// Every action a Certificates row offers is a registered command
// taking the row as its target, so the kebab, the right-click menu and
// the palette all reach the same effect with the same enablement.
// A row command needs a target, so each declares `needs: 'entity'`.

export const CLIENT_CERT_TAB = 'certificates'

// targetIn keeps a command inert on a row of another inventory:
// one context kind serves every family, so the family name is what
// separates them.
function targetIn(ctx: Parameters<NonNullable<Command['enabled']>>[0]): string | null {
  const target = entityContext(ctx, 'clientcert')
  return target?.id ?? null
}

function certExists(id: string): boolean {
  return (useConfigureEntityStore.getState().clientCerts ?? []).some((c) => c.ID === id)
}

export const CLIENT_CERT_COMMANDS: Command[] = [
  {
    id: 'clientcert.edit',
    label: 'commands.clientcert.edit',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const id = targetIn(ctx)
      return id !== null && certExists(id)
    },
    run: (ctx) => {
      const id = targetIn(ctx)
      if (id === null) return
      useAppStore.getState().setView({ kind: 'configure', tab: CLIENT_CERT_TAB })
      useUISignalStore.getState().requestConfigureEdit(CLIENT_CERT_TAB, id)
    },
  },
  {
    id: 'clientcert.duplicate',
    label: 'commands.clientcert.duplicate',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const id = targetIn(ctx)
      return id !== null && certExists(id)
    },
    run: async (ctx) => {
      const id = targetIn(ctx)
      if (id === null) return
      await ConfigureService.DuplicateClientCertificate(id)
      await refreshClientCerts()
    },
  },
  {
    id: 'clientcert.delete',
    label: 'commands.clientcert.delete',
    defaultBinding: null,
    needs: 'entity',
    paletteHidden: true,
    enabled: (ctx) => {
      const id = targetIn(ctx)
      return id !== null && certExists(id)
    },
    run: async (ctx) => {
      const id = targetIn(ctx)
      if (id === null) return
      const label = (useConfigureEntityStore.getState().clientCerts ?? []).find((c) => c.ID === id)?.Label ?? ''
      await ConfigureService.DeleteClientCertificate(id)
      await refreshClientCerts()
      useUndoDeleteStore.getState().show({
        key: `clientcert/${id}`,
        message: copy('undoDelete.deleted', { label }),
        undo: async () => {
          await ConfigureService.UndoDelete('clientcert', id)
          await refreshClientCerts()
        },
      })
    },
  },
]
