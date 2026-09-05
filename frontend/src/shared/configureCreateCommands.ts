import type { Command } from './commands'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'

// One create-flow command per Configure tab that has one (goal 0071
// G6) -- split out of shared/commands.ts (CLAUDE.md's 500-line
// convention), spread into its COMMANDS array below. Always unbound,
// discoverable only by searching the palette. "integration" opens its
// own work tab (request-new) directly, the same already-global
// mechanism ConfigureRequests.tsx's own "New integration" button uses
// -- the other six drive their tab's in-page create form via
// configureCreateRequest (shared/uiSignalStore.ts), consumed by each
// tab's own startCreate(). Attributes has no create command: its rows
// ARE existing workflows (ConfigureAttributes.tsx's own doc comment),
// and jumping to the tab alone can't select one -- there is no "new
// attribute schema" to create independent of an already-existing
// workflow.
export const CONFIGURE_CREATE_COMMANDS: Command[] = [
  {
    id: 'configure.new.integration',
    label: 'commands.configure.new.integration',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'integration' })
      useAppStore.getState().openWorkTab({ kind: 'request-new' })
    },
  },
  {
    id: 'configure.new.lists',
    label: 'commands.configure.new.lists',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'lists' })
      useUISignalStore.getState().requestConfigureCreate('lists')
    },
  },
  {
    id: 'configure.new.mcpservers',
    label: 'commands.configure.new.mcpservers',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'mcpservers' })
      useUISignalStore.getState().requestConfigureCreate('mcpservers')
    },
  },
  {
    id: 'configure.new.decisions',
    label: 'commands.configure.new.decisions',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'decisions' })
      useUISignalStore.getState().requestConfigureCreate('decisions')
    },
  },
  {
    id: 'configure.new.execenvs',
    label: 'commands.configure.new.execenvs',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'execenvs' })
      useUISignalStore.getState().requestConfigureCreate('execenvs')
    },
  },
  {
    id: 'configure.new.environments',
    label: 'commands.configure.new.environments',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'environments' })
      useUISignalStore.getState().requestConfigureCreate('environments')
    },
  },
  {
    id: 'configure.new.aiproviders',
    label: 'commands.configure.new.aiproviders',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'aiproviders' })
      useUISignalStore.getState().requestConfigureCreate('aiproviders')
    },
  },
  {
    id: 'configure.new.certificates',
    label: 'commands.configure.new.certificates',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'certificates' })
      useUISignalStore.getState().requestConfigureCreate('certificates')
    },
  },
  {
    id: 'configure.new.conversionprofiles',
    label: 'commands.configure.new.conversionprofiles',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'conversionprofiles' })
      useUISignalStore.getState().requestConfigureCreate('conversionprofiles')
    },
  },
  {
    id: 'configure.new.steptypes',
    label: 'commands.configure.new.steptypes',
    defaultBinding: null,
    run: () => {
      useAppStore.getState().setView({ kind: 'configure', tab: 'steptypes' })
      useUISignalStore.getState().requestConfigureCreate('steptypes')
    },
  },
]
