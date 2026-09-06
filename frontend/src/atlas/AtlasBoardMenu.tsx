import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu } from '@primer/react'
import { ChevronDownIcon } from '@primer/octicons-react'
import { ATLAS_BOARD_MENU_BANDS } from '../shared/atlasBoardCommands'
import { commandAvailable, commandLabel, findCommand, runCommand } from '../shared/commands'
import { copy } from '../shared/copy'
import { HotkeyHint } from '../shared/HotkeyHint'

// The board's own menu (goal 0355): one place for every action that
// acts on the WHOLE board -- arrange it, add to it, export it, edit its
// structure -- so the toolbar row itself carries only what a person
// switches between (the view) and what they hand to someone else
// (Share).
//
// Every item is a projection of the command registry
// (shared/atlasBoardCommands.ts's ATLAS_BOARD_MENU_BANDS): the band
// declares an id, this component resolves that id's label, its honest
// enablement and its current hotkey. Nothing here calls an action
// directly, so a menu item and the palette entry beside it can never
// mean different things. An item whose command has gone missing renders
// nothing rather than a dead row.
export function AtlasBoardMenu() {
  const { t } = useTranslation('atlas')
  return (
    <ActionMenu>
      <ActionMenu.Button
        size="small"
        variant="invisible"
        trailingAction={ChevronDownIcon}
        data-testid="atlas-board-menu"
        aria-label={t('boardMenu.ariaLabel')}
      >
        {t('boardMenu.button')}
      </ActionMenu.Button>
      <ActionMenu.Overlay data-testid="atlas-board-menu-overlay">
        <ActionList>
          {ATLAS_BOARD_MENU_BANDS.map((band, bandIndex) => (
            <ActionList.Group key={band.label}>
              <ActionList.GroupHeading>{copy(band.label)}</ActionList.GroupHeading>
              {band.items.map((item) => {
                const command = findCommand(item.commandId)
                if (!command) return null
                // Unavailable is DIMMED here, not absent (the one place
                // this surface departs from the palette's "unavailable
                // means absent"): a menu whose rows move as board state
                // changes is unlearnable, and the two image exports go
                // invalid on an empty board alone.
                const enabled = commandAvailable(command)
                return (
                  <ActionList.Item
                    key={command.id}
                    disabled={!enabled}
                    title={!enabled && item.disabledReason ? copy(item.disabledReason) : undefined}
                    data-testid={item.testid ?? `atlas-board-menu-${command.id}`}
                    onSelect={() => { void runCommand(command.id) }}
                  >
                    {item.label ? copy(item.label) : commandLabel(command)}
                    <ActionList.TrailingVisual>
                      <HotkeyHint commandId={command.id} />
                    </ActionList.TrailingVisual>
                  </ActionList.Item>
                )
              })}
              {bandIndex < ATLAS_BOARD_MENU_BANDS.length - 1 && <ActionList.Divider />}
            </ActionList.Group>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
