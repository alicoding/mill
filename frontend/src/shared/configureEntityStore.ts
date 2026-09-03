import { create } from 'zustand'
import { ConfigureService } from './bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { Decision } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import type { ExecEnv } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import type { AIProvider } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import type { DeclaredStepType } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'

// The other half of store.ts's "one fetch, many consumers" server-data
// pattern (workflows/nodeTypes/requests) for Configure's remaining
// reusable entity kinds -- goal 0017 P1-1: before this, each of
// ConfigureLists/ConfigureDecisions/ConfigureMCPServers/ConfigureExecEnv
// held its OWN local useState + its own fetch, so App.tsx's
// mill-data-changed handler had nowhere to push a live update into --
// an already-open Configure tab could never see an entity created
// elsewhere (the UI, another tab, an MCP author) without a full
// remount. A second store file, not more fields on store.ts's
// useAppStore, purely to stay under CLAUDE.md's 500-line-per-file
// convention (useAppStore already carries the work-tab/view state
// machine) -- same shared/ leaf placement, same dependency-cruiser
// boundary (.claude/rules/frontend.md: shared/ has no upward imports),
// just its own `create()` call.
interface ConfigureEntityState {
  lists: List[] | null
  decisions: Decision[] | null
  mcpServers: MCPServer[] | null
  execEnvs: ExecEnv[] | null
  secretSources: SecretSource[] | null
  aiProviders: AIProvider[] | null
  declaredStepTypes: DeclaredStepType[] | null
  setLists: (lists: List[]) => void
  setDecisions: (decisions: Decision[]) => void
  setMCPServers: (mcpServers: MCPServer[]) => void
  setExecEnvs: (execEnvs: ExecEnv[]) => void
  setSecretSources: (secretSources: SecretSource[]) => void
  setAIProviders: (aiProviders: AIProvider[]) => void
  setDeclaredStepTypes: (declaredStepTypes: DeclaredStepType[]) => void
}

export const useConfigureEntityStore = create<ConfigureEntityState>()((set) => ({
  lists: null,
  decisions: null,
  mcpServers: null,
  execEnvs: null,
  secretSources: null,
  aiProviders: null,
  declaredStepTypes: null,
  setLists: (lists) => set({ lists }),
  setDecisions: (decisions) => set({ decisions }),
  setMCPServers: (mcpServers) => set({ mcpServers }),
  setExecEnvs: (execEnvs) => set({ execEnvs }),
  setSecretSources: (secretSources) => set({ secretSources }),
  setAIProviders: (aiProviders) => set({ aiProviders }),
  setDeclaredStepTypes: (declaredStepTypes) => set({ declaredStepTypes }),
}))

// refreshLists/refreshDecisions/refreshMCPServers/refreshExecEnvs mirror
// store.ts's refreshWorkflows/refreshRequests shape exactly: the one
// refetch path per shared list, callable from any surface (a page's
// mount, a form's onSaved, App.tsx's mill-data-changed router) without
// prop threading.
export function refreshLists(): Promise<void> {
  return ConfigureService.Lists()
    .then((list) => useConfigureEntityStore.getState().setLists(list ?? []))
    .catch(console.error)
}

export function refreshDecisions(): Promise<void> {
  return ConfigureService.Decisions()
    .then((list) => useConfigureEntityStore.getState().setDecisions(list ?? []))
    .catch(console.error)
}

export function refreshMCPServers(): Promise<void> {
  return ConfigureService.MCPServers()
    .then((list) => useConfigureEntityStore.getState().setMCPServers(list ?? []))
    .catch(console.error)
}

export function refreshExecEnvs(): Promise<void> {
  return ConfigureService.ExecEnvs()
    .then((list) => useConfigureEntityStore.getState().setExecEnvs(list ?? []))
    .catch(console.error)
}

export function refreshSecretSources(): Promise<void> {
  return ConfigureService.SecretSources()
    .then((list) => useConfigureEntityStore.getState().setSecretSources(list ?? []))
    .catch(console.error)
}

export function refreshAIProviders(): Promise<void> {
  return ConfigureService.AIProviders()
    .then((list) => useConfigureEntityStore.getState().setAIProviders(list ?? []))
    .catch(console.error)
}

export function refreshDeclaredStepTypes(): Promise<void> {
  return ConfigureService.DeclaredStepTypes()
    .then((list) => useConfigureEntityStore.getState().setDeclaredStepTypes(list ?? []))
    .catch(console.error)
}
