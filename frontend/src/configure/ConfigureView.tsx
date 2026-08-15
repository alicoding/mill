import { useTranslation } from 'react-i18next'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureRequests } from './ConfigureRequests'
import { ConfigureLists } from './ConfigureLists'
import { ConfigureAttributes } from './ConfigureAttributes'
import { ConfigureMCPServers } from './ConfigureMCPServers'
import { ConfigureDecisions } from './ConfigureDecisions'
import { ConfigureExecEnv } from './ConfigureExecEnv'
import { ConfigureAIProviders } from './ConfigureAIProviders'
import { ConfigureStepTypes } from './ConfigureStepTypes'

// The Configure surface (docs/SPEC.md §3.5): eight sections for
// Configure-authored data -- Integration (HTTPRequests, 1:many
// reusable, renamed from Connector by ADR-0016), Lists (1:many
// reusable), Attributes (1:1, workflow-scoped), MCP
// Servers (1:many reusable, §3.6 -- the actual "add a whole class of new
// capabilities without a core code change" extension point: each server
// wired up here exposes as many usable mcp-tool-call steps as it has
// tools), Decisions (1:many reusable, docs/adr/0027 -- a workflow's
// TERMINAL outcome), Execution Environments (1:many reusable,
// docs/adr/0026 -- a code-execution node's pinned shell/dir/env), AI
// Providers (1:many reusable, docs/goals/0031-ai-node-family.md -- a
// local Ollama or BYO OpenAI-compatible/Anthropic endpoint an ai-*
// node resolves by ID), and Step types (1:many reusable, ADR-0037 --
// a named palette step assembled from an already-configured HTTP
// operation, MCP tool, or callable workflow, no code). Same
// tabbed-panel pattern as CompositionView.tsx's Workflows/editor tabs
// (Primer's headless Tabs + this app's own TabItem/TabList/TabPanel
// wrappers, Tabs.tsx) -- every panel stays mounted (a `hidden`
// attribute toggles, not unmount), so switching tabs never loses
// in-progress form state in the others.
//
// initialTab (goal 0015's remainder): QuickPanel's Configure-entity
// jump rows land here on the specific tab an entity lives in, via
// App.tsx's `key={view.tab}` forcing a fresh mount (Tabs is
// uncontrolled -- defaultValue only applies on mount, so an
// already-open Configure view wouldn't otherwise re-select on a
// second jump to a different tab).
function ConfigureView({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation('configure')
  return (
    <Tabs defaultValue={initialTab ?? 'integration'}>
      <TabList aria-label={t('configureView.ariaLabel')}>
        <TabItem value="integration">{t('configureView.integration')}</TabItem>
        <TabItem value="lists">{t('configureView.lists')}</TabItem>
        <TabItem value="attributes">{t('configureView.attributes')}</TabItem>
        <TabItem value="mcpservers">{t('configureView.mcpServers')}</TabItem>
        <TabItem value="decisions">{t('configureView.decisions')}</TabItem>
        <TabItem value="execenvs">{t('configureView.execEnvs')}</TabItem>
        <TabItem value="aiproviders">{t('configureView.aiProviders')}</TabItem>
        <TabItem value="steptypes">{t('configureView.stepTypes')}</TabItem>
      </TabList>
      <TabPanel value="integration"><ConfigureRequests /></TabPanel>
      <TabPanel value="lists"><ConfigureLists /></TabPanel>
      <TabPanel value="attributes"><ConfigureAttributes /></TabPanel>
      <TabPanel value="mcpservers"><ConfigureMCPServers /></TabPanel>
      <TabPanel value="decisions"><ConfigureDecisions /></TabPanel>
      <TabPanel value="execenvs"><ConfigureExecEnv /></TabPanel>
      <TabPanel value="aiproviders"><ConfigureAIProviders /></TabPanel>
      <TabPanel value="steptypes"><ConfigureStepTypes /></TabPanel>
    </Tabs>
  )
}

export default ConfigureView
