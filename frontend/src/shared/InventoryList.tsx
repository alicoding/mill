import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, IconButton, Stack, Text, TextInput } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { KebabHorizontalIcon, SearchIcon, type Icon } from '@primer/octicons-react'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu'
import styles from './InventoryList.module.css'
import { searchInputTextAssistOff } from './searchInputProps'

// The shared inventory-row component (docs/goals/0007-resource-
// inventory-redesign.md): one dense, identity-differentiated row for
// every resource-inventory page (Workflows, Integrations, Lists, MCP
// Servers, Decisions), replacing five near-identical fat-card
// renderers (the goal's own problem statement -- different pages
// "look and feel the same," to the point of editing confusion). Built
// on Primer's own ActionList -- native leading visual, inline
// truncated description, trailing visual slots -- rather than
// hand-assembled <div>s, per .claude/rules/frontend.md's "check the
// kit's list family before hand-rolling a collection" rule; Mill had
// only ever used ActionList inside dropdowns before this goal.
//
// `role="list"` on the container is load-bearing, not decorative: it's
// what makes Primer render each Item as a plain <div> instead of a
// native <button> (ActionList/Item.tsx's own `listSemantics` branch).
// Without it, the primary action / kebab-menu buttons this component
// nests inside a row would be invalid HTML (a <button> can't contain
// another <button>) and would silently misbehave. Each nested
// interactive element still needs its own guard against bubbling the
// click up into the row's onOpen, done once here via a stopPropagation
// wrapper around the whole trailing cluster rather than in every
// caller.
export interface InventoryItemIcon {
  Icon: Icon
  bg: string
  fg: string
}

export interface InventoryMenuAction {
  label: string
  onClick: () => void
  danger?: boolean
  // Opt-in confirmation (Button-semantics rule (b), .claude/rules/
  // frontend.md): when set, selecting this action shows ConfirmDialog
  // naming the entity before onClick fires, instead of destroying
  // straight off the kebab click. Every current caller sets this only
  // on a Delete action.
  confirm?: { title: string; body: string }
}

export interface InventoryItem {
  id: string
  // Rendered as data-entity on the row -- the executable form of the
  // goal's "recognition, not confirmation" acceptance bar (a test can
  // assert two pages render different data-entity values without
  // reading any text).
  entity: string
  icon: InventoryItemIcon
  label: string
  labelBadges?: ReactNode
  description?: string
  // A short, muted relative-time caption ("2m ago") rendered in the
  // trailing metadata area (docs/SPEC.md §3.8's InventoryList entry --
  // inventories default-sort last-updated-first; this is the row-level
  // cue that order). Omitted entirely (not even a blank space) for an
  // unstamped/legacy entity -- shared/inventorySort.ts's formatUpdated
  // already returns '' for that case.
  updatedLabel?: string
  meta?: ReactNode
  primaryAction?: ReactNode
  onOpen: () => void
  menuActions: InventoryMenuAction[]
}

export interface InventoryEmptyState {
  icon: Icon
  heading: string
  description: string
  action?: ReactNode
}

// The kebab/right-click convergence (goal 0075's audit G1): a row's
// action list is authored once (InventoryMenuAction[]) and rendered
// through two openers -- the kebab's ActionMenu and a right-click
// ContextMenu -- via this single run path, so a confirm-guarded action
// always shows ConfirmDialog regardless of which opener fired it.
function runMenuAction(action: InventoryMenuAction, requestConfirm: (a: InventoryMenuAction) => void) {
  if (action.confirm) requestConfirm(action)
  else action.onClick()
}

function menuActionsToContextMenuItems(actions: InventoryMenuAction[], requestConfirm: (a: InventoryMenuAction) => void): ContextMenuItem[] {
  return actions.map((action, i) => ({
    id: `${action.label}-${i}`,
    label: action.label,
    danger: action.danger,
    run: () => runMenuAction(action, requestConfirm),
  }))
}

export function InventoryList({ items, emptyState, searchPlaceholder }: {
  items: InventoryItem[]
  emptyState: InventoryEmptyState
  searchPlaceholder?: string
}) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  // One right-click menu for the whole list (goal 0075's audit G1):
  // opening another row's closes whichever was open, since this is a
  // single piece of state shared by every row rather than one per row.
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null)

  // A truly empty inventory (nothing to search) gets the full
  // Blankslate treatment, not a search box over zero rows.
  if (items.length === 0) {
    return <InventoryEmptyBlankslate state={emptyState} />
  }

  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? items
    : items.filter((item) => item.label.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q))

  return (
    <Stack direction="vertical" gap="condensed">
      <TextInput
        leadingVisual={SearchIcon}
        placeholder={searchPlaceholder ?? t('inventoryList.defaultSearchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('inventoryList.searchAriaLabel')}
        {...searchInputTextAssistOff}
        data-testid="inventory-search"
        block
      />
      {filtered.length === 0 ? (
        <Text as="p" size="small" className={styles.muted}>{t('inventoryList.noMatchesFor', { query })}</Text>
      ) : (
        <ActionList role="list" showDividers className={styles.list}>
          {filtered.map((item) => (
            <InventoryRow key={item.id} item={item} onOpenMenu={setRowMenu} />
          ))}
        </ActionList>
      )}
      <ContextMenu state={rowMenu} onClose={() => setRowMenu(null)} />
    </Stack>
  )
}

function InventoryRow({ item, onOpenMenu }: { item: InventoryItem; onOpenMenu: (state: ContextMenuState) => void }) {
  const { t } = useTranslation('common')
  const [pendingConfirm, setPendingConfirm] = useState<InventoryMenuAction | null>(null)
  return (
    <>
    <ActionList.Item
      onSelect={item.onOpen}
      data-testid="inventory-row"
      data-entity={item.entity}
      onContextMenu={(e) => {
        if (item.menuActions.length === 0) return
        e.preventDefault()
        onOpenMenu({ x: e.clientX, y: e.clientY, items: menuActionsToContextMenuItems(item.menuActions, setPendingConfirm) })
      }}
    >
      <ActionList.LeadingVisual>
        <span className={styles.icon} style={{ background: item.icon.bg }}>
          <item.icon.Icon size={16} fill={item.icon.fg} />
        </span>
      </ActionList.LeadingVisual>
      <Stack direction="horizontal" gap="condensed" align="center" className={styles.labelRow}>
        {/* Single-line rows are the whole point of the dense-row
            pattern (goal 0007; owner caught long labels folding into
            3-4 stacked lines with badges tumbling underneath): the
            label truncates with the full name on its title tooltip,
            and badges never shrink or wrap below. */}
        <Text weight="semibold" className={styles.label} title={item.label}>{item.label}</Text>
        {item.labelBadges && <span className={styles.badges}>{item.labelBadges}</span>}
      </Stack>
      {item.description && (
        // ActionList.Description's inline+truncate branch (Primer's
        // compiled source, checked directly) only forwards `children`
        // to the underlying Truncate element, not arbitrary props --
        // data-testid has to live on a child span instead of the
        // Description element itself.
        <ActionList.Description variant="inline" truncate>
          <span data-testid="inventory-row-description">{item.description}</span>
        </ActionList.Description>
      )}
      <ActionList.TrailingVisual>
        {/* Interactive trailing content (a primary action button, the
            kebab menu) needs to stop the click/keypress from also
            bubbling into the Item's own onSelect -- otherwise clicking
            "Run" or opening the menu would also fire onOpen. It ALSO
            needs pointerEvents: 'auto' explicitly -- checked directly
            against Primer's compiled CSS, not assumed: TrailingVisual's
            own wrapper class (VisualWrap) sets `pointer-events: none`
            unconditionally, since Primer's own TrailingVisual is
            designed for decorative content (a count, an icon), never
            interactive controls. Without this override, every button
            in here is present, "visible," but un-clickable -- confirmed
            live via elementFromPoint() before writing this fix; the
            click silently lands on the grid container instead. */}
        <Stack
          direction="horizontal"
          gap="condensed"
          align="center"
          className={styles.rowActions}
          style={{ pointerEvents: 'auto' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {item.updatedLabel && (
            <Text size="small" className={styles.muted} data-testid="inventory-row-updated">
              {item.updatedLabel}
            </Text>
          )}
          {item.meta}
          {item.primaryAction}
          {item.menuActions.length > 0 && (
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={KebabHorizontalIcon}
                  aria-label={t('inventoryList.actionsForAriaLabel', { label: item.label })}
                  size="small"
                  variant="invisible"
                  data-testid="inventory-row-menu"
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay>
                <ActionList>
                  {item.menuActions.map((action) => (
                    <ActionList.Item
                      key={action.label}
                      variant={action.danger ? 'danger' : 'default'}
                      onSelect={() => runMenuAction(action, setPendingConfirm)}
                    >
                      {action.label}
                    </ActionList.Item>
                  ))}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          )}
        </Stack>
      </ActionList.TrailingVisual>
    </ActionList.Item>
    {pendingConfirm?.confirm && (
      <ConfirmDialog
        title={pendingConfirm.confirm.title}
        body={pendingConfirm.confirm.body}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          pendingConfirm.onClick()
          setPendingConfirm(null)
        }}
      />
    )}
    </>
  )
}

function InventoryEmptyBlankslate({ state }: { state: InventoryEmptyState }) {
  return (
    <Blankslate>
      <Blankslate.Visual>
        <state.icon size={32} />
      </Blankslate.Visual>
      <Blankslate.Heading>{state.heading}</Blankslate.Heading>
      <Blankslate.Description>{state.description}</Blankslate.Description>
      {state.action}
    </Blankslate>
  )
}
