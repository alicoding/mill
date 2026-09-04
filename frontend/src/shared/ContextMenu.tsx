import { useRef } from 'react'
import { ActionList, AnchoredOverlay } from '@primer/react'
import { runCommand } from './commands'
import { contextMenuItemLabel, visibleContextMenuItems, type ContextMenuItem, type ContextMenuState } from './contextMenuItem'
import { HotkeyHint } from './HotkeyHint'

// One right-click menu for every surface (goal 0075 -- the
// discoverability trilogy's third leg beside the shortcut and the
// palette): Primer-native via AnchoredOverlay's own documented
// detached-anchor mode (renderAnchor: null + an external anchorRef, a
// 1x1 fixed point at the pointer) wrapping an ActionList. Surfaces
// own WHICH row an item targets; this owns only how a menu looks and
// behaves, and the registry owns what an item does. An item naming a
// commandId resolves its label from the command registry, runs through
// runCommand with the row's own context (goal 0343), and renders the
// same live HotkeyHint the palette shows -- one label, one combo,
// three discovery surfaces that cannot drift.
//
// The item type and its pure rules live in shared/contextMenuItem.ts;
// re-exported here so every existing import site is unchanged.
export type { ContextMenuItem, ContextMenuState }

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  if (!state) return null
  const items = visibleContextMenuItems(state.items)

  return (
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
                onSelect={() => {
                  onClose()
                  // The item's own closure wins when it has one (see
                  // contextMenuItem.ts on the commandId+run pairing);
                  // otherwise the command IS the action.
                  if (item.run) item.run()
                  else if (item.commandId) void runCommand(item.commandId, item.ctx)
                }}
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
  )
}
