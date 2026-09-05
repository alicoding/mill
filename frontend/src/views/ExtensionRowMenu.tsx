import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'
import { commandLabel, findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { EXTENSION_ENTITY } from '../shared/extensionsCommands'
import { ConfirmDialog } from '../shared/ConfirmDialog'

// The row's … menu (docs/goals/0349). Every item RENDERS a registry
// command against this row's own context -- the menu decides nothing
// about whether an action applies, it asks the command's enabled().
// Removing a folder is the one item that confirms first: the folder
// leaves the plugins directory, and the confirm names which one.
const MENU_COMMANDS = ['extension.enable', 'extension.disable', 'extension.reveal'] as const

export function ExtensionRowMenu({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation('views')
  const [confirming, setConfirming] = useState(false)
  const ctx: CommandContext = { kind: 'entity', entity: EXTENSION_ENTITY, id }
  const items = MENU_COMMANDS
    .flatMap((commandId) => {
      const command = findCommand(commandId)
      return command && (command.enabled?.(ctx) ?? true) ? [command] : []
    })
  const removeCommand = findCommand('extension.remove')
  const canRemove = removeCommand !== undefined && (removeCommand.enabled?.(ctx) ?? true)
  if (items.length === 0 && !canRemove) return null

  return (
    <>
      <ActionMenu>
        <ActionMenu.Anchor>
          <IconButton
            icon={KebabHorizontalIcon}
            size="small"
            variant="invisible"
            aria-label={t('settings.extensions.moreActions', { name })}
            data-testid="extensions-row-menu"
          />
        </ActionMenu.Anchor>
        <ActionMenu.Overlay>
          <ActionList>
            {items.map((command) => (
              <ActionList.Item
                key={command.id}
                onSelect={() => { void runCommand(command.id, ctx) }}
                data-testid={`extensions-row-${command.id.replace('extension.', '')}`}
              >
                {commandLabel(command)}
              </ActionList.Item>
            ))}
            {canRemove && (
              <ActionList.Item variant="danger" onSelect={() => setConfirming(true)} data-testid="extensions-row-remove">
                {t('settings.extensions.remove')}
              </ActionList.Item>
            )}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
      {confirming && (
        <ConfirmDialog
          title={t('settings.extensions.removeConfirmTitle', { name })}
          body={t('settings.extensions.removeConfirmBody')}
          confirmLabel={t('settings.extensions.removeConfirmButton')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void runCommand('extension.remove', ctx)
          }}
        />
      )}
    </>
  )
}
