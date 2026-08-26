import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { refreshKeybindings, refreshNodeTypes, refreshRequests, refreshWorkflows } from '../shared/store'
import { refreshAIProviders, refreshDeclaredStepTypes, refreshDecisions, refreshExecEnvs, refreshLists, refreshMCPServers } from '../shared/configureEntityStore'
import { refreshVaultStatus } from '../shared/vaultStatusStore'

// The one mill-data-changed router (docs/adr/0025 + goal 0017), split
// out of App.tsx (CLAUDE.md's 500-line convention) -- zero behavior
// change. Subscribed here, not inside each consuming view, so a
// headless change (a trigger firing, an MCP write) is captured
// regardless of which page happens to be open. Every direct-mutation
// service emits this, one refresher per entity kind, each routed to its
// own store (shared/store.ts's workflows/requests, shared/
// configureEntityStore.ts's lists/decisions/mcpServers/execEnvs/
// aiProviders/declaredStepTypes, shared/vaultStatusStore.ts's
// vaultStatus). 'guardrail-rule' has no shared-store consumer here --
// useGuardrailBadges/the Guardrails section subscribe to it directly.
// 'steptype' (ADR-0037, goal 0054) refreshes BOTH the Configure page's
// own inventory (refreshDeclaredStepTypes) and the canvas palette
// (refreshNodeTypes -- composition.NodeTypes() already merges declared
// types into the same catalog every built-in ships in), so creating/
// editing/deleting a step type reaches the palette without a reload.
export function useDataChangedRouter(): void {
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow' || entity === 'run') void refreshWorkflows()
      if (entity === 'request') void refreshRequests()
      if (entity === 'list') void refreshLists()
      if (entity === 'mcpserver') void refreshMCPServers()
      if (entity === 'decision') void refreshDecisions()
      if (entity === 'execenv') void refreshExecEnvs()
      if (entity === 'aiprovider') void refreshAIProviders()
      if (entity === 'steptype') { void refreshDeclaredStepTypes(); void refreshNodeTypes() }
      if (entity === 'keybinding') void refreshKeybindings()
      if (entity === 'secret') void refreshVaultStatus()
    })
  }, [])
}
