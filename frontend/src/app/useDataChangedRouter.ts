import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { refreshKeybindings, refreshNodeTypes, refreshRequests, refreshWorkflows } from '../shared/store'
import { refreshAIProviders, refreshClientCerts, refreshConversionProfiles, refreshDeclaredStepTypes, refreshDecisions, refreshEnvironments, refreshExecEnvs, refreshLists, refreshMCPServers, refreshSecretSources } from '../shared/configureEntityStore'
import { refreshVaultStatus } from '../shared/vaultStatusStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { refreshDisabledExtensions } from '../shared/extensionEnablementStore'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'
import { refreshPendingReview } from '../review/pendingReviewStore'

// The one mill-data-changed router (docs/adr/0025 + goal 0017), split
// out of App.tsx (CLAUDE.md's 500-line convention) -- zero behavior
// change. Subscribed here, not inside each consuming view, so a
// headless change (a trigger firing, an MCP write) is captured
// regardless of which page happens to be open. Every direct-mutation
// service emits this, one refresher per entity kind, each routed to its
// own store (shared/store.ts's workflows/requests, shared/
// configureEntityStore.ts's lists/decisions/mcpServers/execEnvs/
// environments/conversionProfiles/secretSources/aiProviders/
// clientCerts/declaredStepTypes, shared/vaultStatusStore.ts's
// vaultStatus). 'guardrail-rule' has no shared-store consumer here --
// useGuardrailBadges/the Guardrails section subscribe to it directly.
// 'steptype' (ADR-0037, goal 0054) refreshes BOTH the Configure page's
// own inventory (refreshDeclaredStepTypes) and the canvas palette
// (refreshNodeTypes -- composition.NodeTypes() already merges declared
// types into the same catalog every built-in ships in), so creating/
// editing/deleting a step type reaches the palette without a reload.
// ONE refresher per entity kind, routed to its own store. Every kind
// whose writes can arrive off-surface (a journal-applied undo announces
// through the door's own event, goal 0352 part 2) needs an entry here
// -- without one the restored entity stays invisible until a reload.
const ENTITY_REFRESHERS: Record<string, () => Promise<void> | void> = {
  'workflow': refreshWorkflows,
  // Stopping a run (CancelRun) and answering one (ResolveApproval)
  // both announce through this door and nothing else -- routed here
  // so the Review badge/queue stop needing a poll of their own
  // (review/pendingReviewStore.ts).
  'run': () => { void refreshWorkflows(); void refreshPendingReview() },
  'request': refreshRequests,
  'list': refreshLists,
  'mcpserver': refreshMCPServers,
  'decision': refreshDecisions,
  'execenv': refreshExecEnvs,
  'aiprovider': refreshAIProviders,
  'environment': refreshEnvironments,
  'secretsource': refreshSecretSources,
  'conversionprofile': refreshConversionProfiles,
  'clientcert': refreshClientCerts,
  'steptype': () => { void refreshDeclaredStepTypes(); void refreshNodeTypes() },
  'keybinding': refreshKeybindings,
  // An entry added, edited or deleted anywhere -- this window, a
  // headless write, another surface -- has to reach every open
  // secret picker (goal 0306), not just the vault's lock state.
  'secret': () => { void refreshVaultStatus(); void refreshSecretTitles() },
  'extension': refreshDisabledExtensions,
  'extension-setting': refreshExtensionSettings,
}

export function useDataChangedRouter(): void {
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (!entity) return
      void ENTITY_REFRESHERS[entity]?.()
    })
  }, [])
}
