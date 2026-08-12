import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureRequests } from './ConfigureRequests'
import { ConfigureLists } from './ConfigureLists'
import { ConfigureAttributes } from './ConfigureAttributes'
import { ConfigureMCPServers } from './ConfigureMCPServers'
import { ConfigureDecisions } from './ConfigureDecisions'
import { ConfigureExecEnv } from './ConfigureExecEnv'
import { ConfigureAIProviders } from './ConfigureAIProviders'

// The Configure surface (docs/SPEC.md §3.5): seven sections for
// Configure-authored data -- Integration (HTTPRequests, 1:many
// reusable, renamed from Connector by ADR-0016), Lists (1:many
// reusable), Attributes (1:1, workflow-scoped), MCP
// Servers (1:many reusable, §3.6 -- the actual "add a whole class of new
// capabilities without a core code change" extension point: each server
// wired up here exposes as many usable mcp-tool-call steps as it has
// tools), Decisions (1:many reusable, docs/adr/0027 -- a workflow's
// TERMINAL outcome), Execution Environments (1:many reusable,
// docs/adr/0026 -- a code-execution node's pinned shell/dir/env), and AI
// Providers (1:many reusable, docs/goals/0031-ai-node-family.md -- a
// local Ollama or BYO OpenAI-compatible/Anthropic endpoint an ai-*
// node resolves by ID). Same
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
  return (
    <Tabs defaultValue={initialTab ?? 'integration'}>
      <TabList aria-label="Configure">
        <TabItem value="integration">Integration</TabItem>
        <TabItem value="lists">Lists</TabItem>
        <TabItem value="attributes">Attributes</TabItem>
        <TabItem value="mcpservers">MCP Servers</TabItem>
        <TabItem value="decisions">Decisions</TabItem>
        <TabItem value="execenvs">Execution Environments</TabItem>
        <TabItem value="aiproviders">AI Providers</TabItem>
      </TabList>
      <TabPanel value="integration"><ConfigureRequests /></TabPanel>
      <TabPanel value="lists"><ConfigureLists /></TabPanel>
      <TabPanel value="attributes"><ConfigureAttributes /></TabPanel>
      <TabPanel value="mcpservers"><ConfigureMCPServers /></TabPanel>
      <TabPanel value="decisions"><ConfigureDecisions /></TabPanel>
      <TabPanel value="execenvs"><ConfigureExecEnv /></TabPanel>
      <TabPanel value="aiproviders"><ConfigureAIProviders /></TabPanel>
    </Tabs>
  )
}

export default ConfigureView
