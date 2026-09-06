import type { ReactNode } from 'react'
import { NavList } from '@primer/react'
import type { Icon } from '@primer/octicons-react'
import styles from './RailLayout.module.css'

// The routed surfaces' rail (goal 0321, goal 0116): one NavList.Item
// per pane, and the ONLY way to change panes. aria-current="page"
// rather than "location" -- each item names a distinct route
// (#/settings/<group>, #/configure/<kind>) rather than a position
// within one long page. A group with a title renders as a
// NavList.Group with the title as its heading and the caption as the
// heading's own auxiliary line; a group without one renders its items
// flat (Settings' eight groups need no headings).
export interface NavRailItem<ID extends string> {
  id: ID
  label: string
  href: string
  testId: string
  icon?: Icon
}

export interface NavRailGroup<ID extends string> {
  id: string
  title?: string
  caption?: string
  items: NavRailItem<ID>[]
}

export default function NavRail<ID extends string>({ ariaLabel, testId, groups, activeId, onSelect, header, empty }: {
  ariaLabel: string
  testId: string
  groups: NavRailGroup<ID>[]
  activeId: ID
  onSelect: (id: ID) => void
  // Rendered inside the nav landmark above the list (a filter box).
  header?: ReactNode
  // Rendered instead of the list when no group has an item left.
  empty?: ReactNode
}) {
  const renderItem = (item: NavRailItem<ID>) => {
    const active = item.id === activeId
    const LeadingIcon = item.icon
    return (
      <NavList.Item
        key={item.id}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={active ? styles.railItemActive : undefined}
        data-testid={item.testId}
        onClick={(e) => { e.preventDefault(); onSelect(item.id) }}
      >
        {LeadingIcon && <NavList.LeadingVisual><LeadingIcon /></NavList.LeadingVisual>}
        {item.label}
      </NavList.Item>
    )
  }
  const hasItems = groups.some((g) => g.items.length > 0)
  return (
    <nav className={styles.rail} data-testid={testId} aria-label={ariaLabel}>
      {header && <div className={styles.railHeader}>{header}</div>}
      {hasItems ? (
        <NavList>
          {groups.map((group, index) => group.title ? (
            <NavList.Group key={group.id} hideDivider={index === 0} data-testid={`${testId}-group-${group.id}`}>
              <NavList.GroupHeading auxiliaryText={group.caption}>{group.title}</NavList.GroupHeading>
              {group.items.map(renderItem)}
            </NavList.Group>
          ) : group.items.map(renderItem))}
        </NavList>
      ) : empty}
    </nav>
  )
}
