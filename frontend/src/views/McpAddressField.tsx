import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Stack, Text, TextInput } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Extracted from SettingsView.tsx's inline mcp-access block (same
// line-count reason UpdatesSection/DataStewardshipSection already are
// their own files). Precedence lives in settingsservice_mcpaddr.go's
// ResolveMCPAddr: MILL_MCP_ADDR always wins over this stored setting,
// which is why the field goes read-only whenever envOverride is true
// -- editing it here would have no effect until the env var itself is
// unset.

function McpAddressField() {
  const { t } = useTranslation('views')
  const [address, setAddress] = useState('')
  const [envOverride, setEnvOverride] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    SettingsService.MCPAccessAddressInfo()
      .then((info) => {
        setAddress(info.address)
        setEnvOverride(info.envOverride)
      })
      .catch(console.error)
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
    <FormControl>
      <FormControl.Label>{t('settings.mcp.addressLabel')}</FormControl.Label>
      <Stack direction="horizontal" gap="condensed" align="center">
        <TextInput
          size="small"
          value={address}
          disabled={envOverride}
          onChange={(e) => setAddress(e.target.value)}
          aria-label={t('settings.mcp.addressLabel')}
          data-testid="mcp-access-address-input"
        />
        {!envOverride && (
          <Button size="small" onClick={save} data-testid="mcp-access-address-save">
            {t('settings.mcp.addressSave')}
          </Button>
        )}
      </Stack>
      <FormControl.Caption>
        {envOverride ? t('settings.mcp.addressEnvOverrideCaption') : t('settings.mcp.addressCaption')}
      </FormControl.Caption>
      {saved && (
        <Text size="small" className={styles.muted} data-testid="mcp-access-address-saved">
          {t('settings.mcp.addressSaved')}
        </Text>
      )}
      {error && (
        <Text size="small" className={styles.error} data-testid="mcp-access-address-error">
          {error}
        </Text>
      )}
    </FormControl>
  )
}

export default McpAddressField
