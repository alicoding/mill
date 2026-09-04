import type { ReactNode } from 'react'
import { Button, Heading } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import styles from './ExamplesSection.module.css'

// The one collapsible group every list surface wearing the list
// standard (docs/goals/0337) puts at its bottom -- InventoryList's own
// Examples group and Extensions' installed-list Built-in group both
// render through this. A disclosure button over the caller's OWN rows,
// never an ActionList.Group: Primer's Group has no expand/collapse API
// of its own (checked directly against the installed version's
// compiled Group.js, which exposes only variant/title/auxiliaryText/
// selectionVariant) and is unusable at all inside a role="list"
// ActionList -- Group emits a role="none" wrapper around an h3 and a
// role="group" list there, which axe rejects (aria-required-children /
// listitem). Collapsed means `children` is not rendered at all -- not
// hidden -- so nothing collapsed is reachable by a stale locator or
// the tab order.
export function ExamplesSection({
  count, expanded, onToggle, heading, showLabel, hideLabel, testId, toggleTestId, children,
}: {
  count: number
  expanded: boolean
  onToggle: (expanded: boolean) => void
  heading: string
  showLabel: string
  hideLabel: string
  testId?: string
  toggleTestId?: string
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <div data-testid={testId}>
      <Heading as="h3" className={styles.heading}>
        <Button
          variant="invisible"
          size="small"
          leadingVisual={expanded ? ChevronDownIcon : ChevronRightIcon}
          aria-expanded={expanded}
          onClick={() => onToggle(!expanded)}
          title={expanded ? hideLabel : showLabel}
          data-testid={toggleTestId}
        >
          {heading}
        </Button>
      </Heading>
      {expanded && children}
    </div>
  )
}
