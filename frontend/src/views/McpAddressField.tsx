import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text, TextInput } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { SettingsRow } from './SettingsRow'
import styles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// Settings > Connections' MCP address row. Precedence lives in
// settingsservice_mcpaddr.go's ResolveMCPAddr: MILL_MCP_ADDR always
// wins over this stored setting, which is why the field goes read-only
// whenever envOverride is true -- editing it here would have no effect
// until the env var itself is unset.
const MCP_DOCS_PAGE = 'agents/connect-mcp.md'

function McpAddressField() {
  const { t } = useTranslation('views')
  const [address, setAddress] = useState('')
  const [envOverride, setEnvOverride] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void background(SettingsService.MCPAccessAddressInfo()
      .then((info) => {
        setAddress(info.address)
        setEnvOverride(info.envOverride)
      }), 'mcpAddress.addressInfo')
  }, [])

  const save = () => {
    setSaved(false)
    setError('')
    const next = address.trim()
    SettingsService.SetMCPAccessAddress(next)
      .then(() => SettingsService.MCPAccessAddressInfo())
      .then((info) => {
        setAddress(info.address)
        setEnvOverride(info.envOverride)
        setSaved(true)
      })
      .catch((err) => setError(String(err)))
  }

  return (
    <>
      <SettingsRow
        label={t('settings.mcp.addressLabel')}
        caption={envOverride ? t('settings.mcp.addressEnvOverrideCaption') : t('settings.mcp.addressCaption')}
        docsPage={envOverride ? undefined : MCP_DOCS_PAGE}
        control={(labelId) => (
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput
              size="small"
              value={address}
              disabled={envOverride}
              onChange={(e) => setAddress(e.target.value)}
              aria-labelledby={labelId}
              data-testid="mcp-access-address-input"
            />
            {!envOverride && (
              <Button size="small" onClick={save} data-testid="mcp-access-address-save">
                {t('settings.mcp.addressSave')}
              </Button>
            )}
          </Stack>
        )}
      />
      {saved && (
        <Text as="p" size="small" className={styles.muted} data-testid="mcp-access-address-saved">
          {t('settings.mcp.addressSaved')}
        </Text>
      )}
      {error && (
        <Text as="p" size="small" className={styles.error} data-testid="mcp-access-address-error">
          {error}
        </Text>
      )}
    </>
  )
}

export default McpAddressField
