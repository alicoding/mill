import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Heading, Text } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import McpAddressField from './McpAddressField'
import RemoteAccessSection from './RemoteAccessSection'
import ContractSection from './ContractSection'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'

// Where the rest of the two trimmed MCP captions lives (goal 0321).
const MCP_DOCS_PAGE = 'agents/connect-mcp.md'

// Settings > Connections (goal 0321): everything that reaches Mill
// from outside, one pane in reach order -- an MCP client on this Mac,
// a paired device on the network, and the offline contract handed to
// an agent that reaches Mill through neither. They were three
// separate sections of the old scroll with nothing naming what they
// had in common.
export default function SettingsConnectionsPane() {
  const { t } = useTranslation('views')
  const [mcpWriteEnabled, setMCPWriteEnabledState] = useState<boolean | null>(null)
  const [mcpApprovalRequired, setMCPApprovalRequiredState] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    SettingsService.GetMCPWriteEnabled()
      .then(setMCPWriteEnabledState)
      .catch((err) => { console.error(err); setLoadError(true) })
    SettingsService.GetMCPWriteApprovalRequired()
      .then(setMCPApprovalRequiredState)
      .catch((err) => { console.error(err); setLoadError(true) })
  }, [])

  return (
    <>
      {loadError && (
        <Text as="p" size="small" className={listStyles.error} data-testid="settings-load-error">
          {t('settings.loadError')}
        </Text>
      )}

      <div data-testid="settings-section-mcp-access">
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.mcpTitle')}
        </Heading>
        <McpAddressField />
        <SettingsRow
          label={t('settings.mcp.allowImportLabel')}
          caption={t('settings.mcp.allowImportCaption')}
          docsPage={MCP_DOCS_PAGE}
          control={(labelId) => (
            <Checkbox
              aria-labelledby={labelId}
              checked={mcpWriteEnabled ?? false}
              disabled={mcpWriteEnabled === null}
              onChange={(e) => {
                const enabled = e.target.checked
                SettingsService.SetMCPWriteEnabled(enabled).then(() => setMCPWriteEnabledState(enabled)).catch(console.error)
              }}
              data-testid="mcp-write-enabled-checkbox"
            />
          )}
        />
        {mcpWriteEnabled && (
          <SettingsRow
            label={t('settings.mcp.askBeforeImportLabel')}
            caption={t('settings.mcp.askBeforeImportCaption')}
            docsPage={MCP_DOCS_PAGE}
            control={(labelId) => (
              <Checkbox
                aria-labelledby={labelId}
                checked={mcpApprovalRequired ?? true}
                disabled={mcpApprovalRequired === null}
                onChange={(e) => {
                  const required = e.target.checked
                  SettingsService.SetMCPWriteApprovalRequired(required).then(() => setMCPApprovalRequiredState(required)).catch(console.error)
                }}
                data-testid="mcp-write-approval-checkbox"
              />
            )}
          />
        )}
      </div>

      <div data-testid="settings-section-remote-access" className={styles.panel}>
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.remoteTitle')}
        </Heading>
        <RemoteAccessSection />
      </div>

      <div data-testid="settings-section-contract" className={styles.panel}>
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.contractTitle')}
        </Heading>
        <ContractSection />
      </div>
    </>
  )
}
