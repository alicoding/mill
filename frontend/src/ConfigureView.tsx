import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from './Tabs'
import { ConfigureIntegration } from './ConfigureIntegration'
import { ConfigureLists } from './ConfigureLists'
import { ConfigureAttributes } from './ConfigureAttributes'

// The Configure surface (docs/SPEC.md §3.5): three sections for
// Configure-authored data -- Integration (Connectors, 1:many reusable),
// Lists (1:many reusable), and Attributes (1:1, workflow-scoped). Same
// tabbed-panel pattern as CompositionView.tsx's Workflows/editor tabs
// (Primer's headless Tabs + this app's own TabItem/TabList/TabPanel
// wrappers, Tabs.tsx) -- every panel stays mounted (a `hidden` attribute
// toggles, not unmount), so switching tabs never loses in-progress form
// state in the others.
function ConfigureView() {
  return (
    <Tabs defaultValue="integration">
      <TabList aria-label="Configure">
        <TabItem value="integration">Integration</TabItem>
        <TabItem value="lists">Lists</TabItem>
        <TabItem value="attributes">Attributes</TabItem>
      </TabList>
      <TabPanel value="integration"><ConfigureIntegration /></TabPanel>
      <TabPanel value="lists"><ConfigureLists /></TabPanel>
      <TabPanel value="attributes"><ConfigureAttributes /></TabPanel>
    </Tabs>
  )
}

export default ConfigureView
