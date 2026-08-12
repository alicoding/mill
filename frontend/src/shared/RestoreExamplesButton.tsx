import { ActionList, ActionMenu } from '@primer/react'
import { HistoryIcon } from '@primer/octicons-react'

// "Restore example…" (docs/goals/0037 item 5): every resource-inventory
// page's header gains this affordance when -- and only when -- that
// page has at least one deliberately-deleted (tombstoned) built-in
// example still restorable. One shared component rather than six
// near-identical ActionMenus (RestorableWorkflows/RestorableHTTPRequests/
// RestorableDecisions/RestorableLists/RestorableMCPServers/
// RestorableExecEnvs already share the exact same {ID, Label} read
// shape on the wire).
export interface RestorableItem {
  ID: string
  Label: string
}

export function RestoreExamplesButton({ items, onRestore }: {
  items: RestorableItem[]
  onRestore: (id: string) => void
}) {
  // Appears only when applicable (docs/goals/0037 item 5's own wording)
  // -- no empty/disabled placeholder button cluttering a page that has
  // nothing tombstoned.
  if (items.length === 0) return null
  return (
    <ActionMenu>
      <ActionMenu.Button leadingVisual={HistoryIcon} size="small" data-testid="restore-examples-menu">
        Restore example…
      </ActionMenu.Button>
      <ActionMenu.Overlay>
        <ActionList>
          {items.map((item) => (
            <ActionList.Item key={item.ID} onSelect={() => onRestore(item.ID)} data-testid="restore-example-item">
              {item.Label}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

