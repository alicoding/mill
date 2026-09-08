import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, Checkbox, IconButton, Stack, Text } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon, KebabHorizontalIcon } from '@primer/octicons-react'
import { ConfirmDialog } from './ConfirmDialog'
import { menuActionLabel, menuActionsToContextMenuItems, performMenuAction, runMenuAction, visibleMenuActions, type ContextMenuOpener, type InventoryItem, type InventoryMenuAction } from './inventoryItem'
import type { PointerLike } from './useListSelection'
import styles from './InventoryList.module.css'

// A row's own selection affordance (goal 0404 S1), built by
// InventoryList from its one shared useListSelection instance --
// InventoryRow never imports the hook itself, only this small
// per-row projection of it. `longPress` is present only at a narrow/
// companion viewport (InventoryList's own wiring decision); its
// absence is what keeps a long touch-and-hold from arming selection
// mode on a desktop-width pointer-driven layout.
export interface InventoryRowSelection {
  isSelected: boolean
  isSelectionMode: boolean
  // A row click's modifiers decide toggle/range/open (the hook's own
  // activate()) -- returns whether the row should still open.
  onActivate: (mods: { shiftKey: boolean; toggleModifier: boolean }) => boolean
  // The checkbox's own click (goal 0404 S1): the SAME
  // Shift-ranges/toggle-modifier-toggles branches onActivate
  // uses, so a modifier on the checkbox behaves exactly like the same
  // modifier on the row body (Gmail/Drive) -- but a checkbox never
  // opens the row, so a plain click toggles instead of returning an
  // "open me" signal (shared/listSelectionCore.ts's activateCheckbox).
  onActivateCheckbox: (mods: { shiftKey: boolean; toggleModifier: boolean }) => void
  // The row's own real focus (Tab landing on it, goal 0404 S1) --
  // publishes this row as the target Space/x/Shift+Space
  // act on (shared/listSelectionCommands.ts). The checkbox itself
  // carries tabIndex={-1} below so Tab lands on the ROW, never the
  // checkbox, matching Gmail/Linear's own keyboard shape.
  onRowFocus: () => void
  longPress?: {
    onPointerDown: (e: PointerLike) => void
    onPointerMove: (e: PointerLike) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
}

// One dense, identity-differentiated row for every resource inventory
// (docs/goals/0007-resource-inventory-redesign.md), split out of
// InventoryList.tsx when the one list standard (docs/goals/0337) added
// the toolbar, the Examples group and pagination to the same file.
//
// `role="list"` on the OWNING ActionList is load-bearing, not
// decorative: it's what makes Primer render each Item as a plain <div>
// instead of a native <button> (ActionList/Item.tsx's own
// `listSemantics` branch). Without it, the primary action / kebab-menu
// buttons this component nests inside a row would be invalid HTML (a
// <button> can't contain another <button>) and would silently
// misbehave. Each nested interactive element still needs its own guard
// against bubbling the click up into the row's onOpen, done once here
// via a stopPropagation wrapper around the whole trailing cluster
// rather than in every caller.
export function InventoryRow({ item, onOpenMenu, selection }: { item: InventoryItem; onOpenMenu: ContextMenuOpener; selection?: InventoryRowSelection }) {
  const { t } = useTranslation('common')
  const [pendingConfirm, setPendingConfirm] = useState<InventoryMenuAction | null>(null)
  // Unavailable means ABSENT (goal 0343): an action whose registry
  // command can't act on this row never renders, in either opener.
  const actions = visibleMenuActions(item.menuActions)
  return (
    <>
    <ActionList.Item
      onSelect={(e) => {
        if (!selection) {
          item.onOpen()
          return
        }
        const opensRow = selection.onActivate({ shiftKey: e.shiftKey, toggleModifier: e.metaKey || e.ctrlKey })
        if (opensRow) item.onOpen()
      }}
      data-testid="inventory-row"
      data-entity={item.entity}
      data-selection-mode={selection?.isSelectionMode ? 'true' : undefined}
      onFocus={selection?.onRowFocus}
      onKeyDown={(e) => {
        // Enter opens (goal 0404 S1) -- driven here directly rather
        // than relying on Primer's own onSelect/
        // onKeyPress wiring for it: onKeyPress is a deprecated DOM
        // event whose firing on a plain (non-form) element is no
        // longer reliable across engines, confirmed live (Enter
        // stopped opening a selection-enabled row). preventDefault on
        // this keydown also suppresses the keypress Primer's own
        // handler answers to, so this never double-fires alongside it.
        if (e.key !== 'Enter' || !selection) return
        e.preventDefault()
        item.onOpen()
      }}
      onContextMenu={(e) => {
        if (actions.length === 0) return
        e.preventDefault()
        onOpenMenu({ x: e.clientX, y: e.clientY, items: menuActionsToContextMenuItems(actions) })
      }}
      {...(selection?.longPress
        ? {
          onPointerDown: (e: React.PointerEvent) => selection.longPress!.onPointerDown(e),
          onPointerMove: (e: React.PointerEvent) => selection.longPress!.onPointerMove(e),
          onPointerUp: () => selection.longPress!.onPointerUp(),
          onPointerCancel: () => selection.longPress!.onPointerCancel(),
        }
        : {})}
    >
      <ActionList.LeadingVisual>
        {/* pointerEvents: 'auto' is load-bearing, not decorative -- the
            SAME VisualWrap-class override the trailing cluster below
            already needs (checked directly against Primer's compiled
            CSS: LeadingVisual's own wrapper sets `pointer-events: none`
            unconditionally too, since Primer's LeadingVisual is
            designed for a decorative icon, never an interactive
            control). Without it every click on the checkbox below
            passes straight through to the grid container underneath. */}
        <Stack direction="horizontal" gap="condensed" align="center" style={{ pointerEvents: 'auto' }}>
          {selection && (
            // Hover/focus-revealed via InventoryList.module.css's
            // [data-testid='inventory-row']:hover/:focus-within rule,
            // persistent while data-selection-mode is set above.
            // onKeyDown on the wrapper stops ONLY Enter/Space -- the
            // checkbox's own native keyboard activation, which would
            // otherwise ALSO bubble into the row's onSelect the same
            // way a click does. Every other key (⌘A, ⌘Z, Esc, ⌫) must
            // keep bubbling: the checkbox holds focus right after a
            // click, and those are window-level shortcuts
            // (app/useKeymapDispatch.ts) that a blanket stopPropagation
            // here would silently swallow.
            <span
              className={styles.checkboxSlot}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
            >
              <Checkbox
                checked={selection.isSelected}
                // Out of the tab order (goal 0404 S1, Gmail/Linear
                // shape): Tab lands on the
                // ROW, never the checkbox -- a click still reaches and
                // focuses it (tabIndex -1 only removes it from Tab's
                // own traversal, not from focusability).
                tabIndex={-1}
                // Fully controlled by onClick below (which reads the
                // click's own Shift/Cmd/Ctrl modifiers -- a "change"
                // event carries none) -- this stays a deliberate no-op
                // only to keep React's controlled-input contract happy.
                onChange={() => {}}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  selection.onActivateCheckbox({ shiftKey: e.shiftKey, toggleModifier: e.metaKey || e.ctrlKey })
                }}
                aria-label={t('inventoryList.selectRowAriaLabel', { label: item.label })}
                data-testid="inventory-row-select"
              />
            </span>
          )}
          <span className={styles.icon} style={{ background: item.icon.bg }}>
            <item.icon.Icon size={16} fill={item.icon.fg} />
          </span>
        </Stack>
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
      {item.disclosure && (
        // The same bubbling guard the trailing cluster carries: the
        // expander is a button inside the Item's body, so without the
        // guard a key-list click would also fire the row's onSelect.
        <div
          className={styles.disclosure}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="invisible"
            size="small"
            leadingVisual={item.disclosure.expanded ? ChevronDownIcon : ChevronRightIcon}
            aria-expanded={item.disclosure.expanded}
            onClick={() => item.disclosure!.onToggle(!item.disclosure!.expanded)}
            data-testid={`inventory-row-disclosure-${item.id}`}
          >
            {item.disclosure.expanded ? item.disclosure.hideLabel : item.disclosure.showLabel}
          </Button>
          {item.disclosure.expanded && (
            <div data-testid={`inventory-row-disclosure-content-${item.id}`}>{item.disclosure.content}</div>
          )}
        </div>
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
          {actions.length > 0 && (
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
                  {actions.map((action, i) => (
                    <ActionList.Item
                      key={`${menuActionLabel(action)}-${i}`}
                      variant={action.danger ? 'danger' : 'default'}
                      onSelect={() => runMenuAction(action, setPendingConfirm)}
                    >
                      {menuActionLabel(action)}
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
          performMenuAction(pendingConfirm)
          setPendingConfirm(null)
        }}
      />
    )}
    </>
  )
}
