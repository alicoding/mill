import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureIntegration } from './ConfigureIntegration'
import { ConfigureLists } from './ConfigureLists'
import { ConfigureAttributes } from './ConfigureAttributes'
import { ConfigureMCPServers } from './ConfigureMCPServers'

// The Configure surface (docs/SPEC.md §3.5): four sections for
// Configure-authored data -- Integration (Connectors, 1:many reusable),
// Lists (1:many reusable), Attributes (1:1, workflow-scoped), and MCP
// Servers (1:many reusable, §3.6 -- the actual "add a whole class of new
// capabilities without a core code change" extension point: each server
// wired up here exposes as many usable mcp-tool-call steps as it has
// tools). Same tabbed-panel pattern as CompositionView.tsx's Workflows/
// editor tabs (Primer's headless Tabs + this app's own TabItem/TabList/
// TabPanel wrappers, Tabs.tsx) -- every panel stays mounted (a `hidden`
// attribute toggles, not unmount), so switching tabs never loses
// in-progress form state in the others.
function ConfigureView() {
  return (
    <Tabs defaultValue="integration">
      <TabList aria-label="Configure">
        <TabItem value="integration">Integration</TabItem>
        <TabItem value="lists">Lists</TabItem>
        <TabItem value="attributes">Attributes</TabItem>
        <TabItem value="mcpservers">MCP Servers</TabItem>
      </TabList>
      <TabPanel value="integration"><ConfigureIntegration /></TabPanel>
      <TabPanel value="lists"><ConfigureLists /></TabPanel>
      <TabPanel value="attributes"><ConfigureAttributes /></TabPanel>
      <TabPanel value="mcpservers"><ConfigureMCPServers /></TabPanel>
    </Tabs>
  )
}

export default ConfigureView
