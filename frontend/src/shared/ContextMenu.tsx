import { useRef, useState } from 'react'
import { ActionList, AnchoredOverlay } from '@primer/react'
import { runCommand } from './commands'
import { ConfirmDialog } from './ConfirmDialog'
import { contextMenuItemConfirm, contextMenuItemLabel, visibleContextMenuItems, type ContextMenuItem, type ContextMenuState } from './contextMenuItem'
import { HotkeyHint } from './HotkeyHint'

// One right-click menu for every surface (goal 0075 -- the
// discoverability trilogy's third leg beside the shortcut and the
// palette): Primer-native via AnchoredOverlay's own documented
// detached-anchor mode (renderAnchor: null + an external anchorRef, a
// 1x1 fixed point at the pointer) wrapping an ActionList. Surfaces
// own WHICH row an item targets; this owns only how a menu looks and
// behaves, and the registry owns what an item does. An item resolves
// its label from the command registry for its own target, runs through
// runCommand with that target (goal 0343), and renders the same live
// HotkeyHint the palette shows -- one label, one combo, three discovery
// surfaces that cannot drift. A submenu replaces the list in place; a
// confirm question is asked here, once, for every surface.
//
// The item type and its pure rules live in shared/contextMenuItem.ts;
// re-exported here so every existing import site is unchanged.
export type { ContextMenuItem, ContextMenuState }

type PendingConfirm = { item: ContextMenuItem; title: string; body: string; confirmLabel?: string }

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  // Keyed on the state object itself, so a newly opened menu never
  // inherits the previous one's drilled submenu.
  const [drill, setDrill] = useState<{ of: ContextMenuState; items: ContextMenuItem[] } | null>(null)
  // Outlives the menu: the dialog renders after onClose has cleared
  // the state that opened it.
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const select = (item: ContextMenuItem) => {
    if (item.submenu) {
      if (state) setDrill({ of: state, items: item.submenu })
      return
    }
    onClose()
    if (!item.commandId) return
    const confirm = contextMenuItemConfirm(item)
    if (confirm) setPending({ item, ...confirm })
    else void runCommand(item.commandId, item.ctx)
  }

  const items = state ? visibleContextMenuItems(drill?.of === state ? drill.items : state.items) : []

  return (
    <>
      {state && (
        <>
          <div
            ref={anchorRef}
            style={{ position: 'fixed', left: state.x, top: state.y, width: 1, height: 1, pointerEvents: 'none' }}
            aria-hidden="true"
          />
          <AnchoredOverlay
            open
            onClose={onClose}
            renderAnchor={null}
            anchorRef={anchorRef}
            overlayProps={{ role: 'menu', 'data-testid': 'context-menu' } as never}
          >
            <ActionList>
              {items.map((item) => {
                if (item.divider) return <ActionList.Divider key={item.id} />
                return (
                  <ActionList.Item
                    key={item.id}
                    variant={item.danger ? 'danger' : 'default'}
                    onSelect={() => select(item)}
                  >
                    {contextMenuItemLabel(item)}
                    {item.commandId && (
                      <ActionList.TrailingVisual>
                        <HotkeyHint commandId={item.commandId} />
                      </ActionList.TrailingVisual>
                    )}
                  </ActionList.Item>
                )
              })}
            </ActionList>
          </AnchoredOverlay>
        </>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { item } = pending
            setPending(null)
            if (item.commandId) void runCommand(item.commandId, item.ctx)
          }}
        />
      )}
    </>
  )
}
