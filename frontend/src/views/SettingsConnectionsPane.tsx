import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Heading, Text } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import McpAddressField from './McpAddressField'
import RemoteAccessSection from './RemoteAccessSection'
import BrowsersSection from './BrowsersSection'
import AgentHooksSection from './AgentHooksSection'
import ContractSection from './ContractSection'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'
import { background } from '../shared/background'

// Where the rest of the two trimmed MCP captions lives (goal 0321).
const MCP_DOCS_PAGE = 'agents/connect-mcp.md'

// Settings > Connections (goal 0321, regrouped goal 0369): the
// converged noun-kind order -- Devices (a phone or computer paired to
// reach Mill), Browsers, Credentials (what other tools authenticate
// with: MCP, webhook tokens), then the offline Contract. The old flat
// order led with the most technical section and hid the phone/device
// flow under "Remote access", read as broken (goal 0369's goal file).
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

      {/* Testid kept as "remote-access" (its pre-0369 name): a copy-only
          relabel to "Devices" has no reason to move a data-testid an
          existing e2e spec (remote-access.spec.ts) already depends on. */}
      <div data-testid="settings-section-remote-access" className={styles.panel}>
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.devicesTitle')}
        </Heading>
        <Text as="p" size="small" className={listStyles.muted}>
          {t('settings.connections.devicesCaption')}
        </Text>
        <RemoteAccessSection />
      </div>

      <div data-testid="settings-section-browsers" className={styles.panel}>
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.browsersTitle')}
        </Heading>
        <BrowsersSection />
      </div>

      <div data-testid="settings-section-credentials" className={styles.panel}>
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('settings.connections.credentialsTitle')}
        </Heading>
        <Text as="p" size="small" className={listStyles.muted}>
          {t('settings.connections.credentialsCaption')}
        </Text>

        <div data-testid="settings-section-mcp-access">
          <Text as="h3" size="small" weight="semibold" className={listStyles.muted} style={{ marginTop: 'var(--base-size-16)' }} data-testid="settings-subsection-heading">
            {t('settings.connections.mcpTitle')}
          </Text>
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
                  void background(SettingsService.SetMCPWriteEnabled(enabled).then(() => setMCPWriteEnabledState(enabled)), 'settingsConnectionsPane.setMCPWriteEnabled')
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
                    void background(SettingsService.SetMCPWriteApprovalRequired(required).then(() => setMCPApprovalRequiredState(required)), 'settingsConnectionsPane.setMCPWriteApprovalRequired')
                  }}
                  data-testid="mcp-write-approval-checkbox"
                />
              )}
            />
          )}
        </div>

        <div data-testid="settings-section-webhooks">
          <Text as="h3" size="small" weight="semibold" className={listStyles.muted} style={{ marginTop: 'var(--base-size-16)' }} data-testid="settings-subsection-heading">
            {t('settings.connections.hooksTitle')}
          </Text>
          <AgentHooksSection />
        </div>
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
