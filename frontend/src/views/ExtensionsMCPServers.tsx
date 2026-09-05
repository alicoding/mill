import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import type { MCPServerContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { EXTENSION_ENTITY, mcpServerEntityID } from '../shared/extensionsCommands'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// The MCP servers an extension ships (docs/goals/0349 S5), under
// Contributions: one row per declared server -- its label, the command
// line that starts it -- and the "Add to Configure" command that
// creates the MCP Server entity through Configure's own create door.
// Every secret the server needs travels as a reference read from the
// extension's own secretRef setting, so the row never shows a value.
export function ExtensionsMCPServers({ pluginId, servers }: {
  pluginId: string
  servers: MCPServerContribution[]
}) {
  const { t } = useTranslation('views')
  const command = findCommand('extension.addMcpServer')
  if (servers.length === 0) return null
  return (
    <Stack direction="vertical" gap="none" data-testid="extensions-mcp-servers">
      <Text as="p" size="small" weight="semibold">{t('extensions.mcpServers.heading')}</Text>
      <ul className={styles.rows} aria-label={t('extensions.mcpServers.heading')}>
        {servers.map((server) => {
          const ctx: CommandContext = { kind: 'entity', entity: EXTENSION_ENTITY, id: mcpServerEntityID(pluginId, server.id) }
          const enabled = command !== undefined && (command.enabled?.(ctx) ?? true)
          const commandLine = [server.command, ...(server.args ?? [])].join(' ')
          const secretKeys = Object.entries(server.env ?? {}).filter(([, v]) => (v ?? '').startsWith('secretRef:')).map(([k]) => k)
          return (
            <li key={server.id} data-testid="extensions-mcp-server" data-server-id={server.id}>
              <div className={styles.row}>
                <span className={styles.rowButton}>
                  <Text size="small" weight="semibold" className={styles.rowName}>{server.label}</Text>
                  <Text size="small" className={styles.rowDescription} title={commandLine} data-testid="extensions-mcp-server-command">
                    {commandLine}
                  </Text>
                </span>
                <span className={styles.rowMeta}>
                  {secretKeys.length > 0 && (
                    <Text size="small" className={listStyles.muted}>{t('extensions.mcpServers.usesSecrets', { list: secretKeys.join(', ') })}</Text>
                  )}
                  <Button
                    size="small"
                    disabled={!enabled}
                    onClick={() => { void runCommand('extension.addMcpServer', ctx) }}
                    aria-label={t('extensions.mcpServers.addAria', { label: server.label })}
                    data-testid="extensions-mcp-add"
                  >
                    {t('extensions.mcpServers.add')}
                  </Button>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </Stack>
  )
}
