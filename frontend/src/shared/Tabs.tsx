import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { useTab, useTabList, useTabPanel } from '@primer/react/experimental'
import { XIcon } from '@primer/octicons-react'
import styles from './Tabs.module.css'

// Wrapper components around @primer/react/experimental's useTab/
// useTabList/useTabPanel hooks. That package ships the tab-selection
// state machine and ARIA/keyboard behavior (confirmed directly against
// its compiled source: only the hooks are exported, no ready-made Tab/
// TabList/TabPanel components -- its own doc comment calls those
// "provided for convenience" but that convenience layer isn't in the
// npm package). Building this thin markup layer on top is the intended
// usage of a headless primitive, not a reinvention of tabs. Must be
// used inside a `<Tabs>` provider from the same package.

export function TabList({ 'aria-label': ariaLabel, children }: { 'aria-label': string; children: ReactNode }) {
  const { tabListProps } = useTabList<HTMLDivElement>({ 'aria-label': ariaLabel })
  // tabListProps.ref is typed against React 19's nullable RefObject
  // shape; this app's @types/react (18) is stricter about what a JSX
  // ref accepts -- a version-skew typing mismatch, not a real bug, so
  // the ref is re-asserted rather than fighting the two packages' types.
  return (
    <div {...tabListProps} ref={tabListProps.ref as Ref<HTMLDivElement>} className={styles.tabList}>
      {children}
    </div>
  )
}

// A close control is rendered as a DOM *sibling* of the tab's own
// <button role="tab">, not a nested <button> -- interactive elements
// can't validly nest inside a <button>, which would also make a click
// on Close ambiguously also select the tab.
export function TabItem({ value, children, kicker, onClose }: { value: string; children: ReactNode; kicker?: string; onClose?: () => void }) {
  const { tabProps } = useTab<HTMLButtonElement>({ value })
  return (
    <div className={styles.tabItem}>
      <button {...tabProps} type="button" className={styles.tab}>
        {/* The two-line work-tab pattern (reference-platform precedent,
            owner-requested): a small uppercase KIND line above the name,
            so a tab self-identifies what sort of thing it holds before
            the label is read (recognition-not-confirmation,
            docs/SPEC.md §3.8). aria-hidden keeps it out of the tab's
            accessible name -- every getByRole('tab', { name }) selector
            and screen-reader announcement stays exactly the label. */}
        {kicker && <span aria-hidden="true" data-testid="tab-kicker" className={styles.tabKicker}>{kicker}</span>}
        {/* Row wrapper: .tab is a flex COLUMN now (kicker above label);
            without this, a multi-part label (text + dirty dot) would
            stack vertically too. */}
        <span className={styles.tabLabelRow}>{children}</span>
      </button>
      {onClose && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Close tab"
          className={styles.tabClose}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClose()
            }
          }}
        >
          <XIcon size={12} />
        </span>
      )}
    </div>
  )
}

export function TabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const { tabPanelProps } = useTabPanel<HTMLDivElement>({ value })
  return (
    <div {...tabPanelProps} className={className}>
      {children}
    </div>
  )
}
