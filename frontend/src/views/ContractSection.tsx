import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { AuditService, SettingsService } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Settings → Contract: the two machine-readable exports for an agent
// that can't reach Mill directly -- mill://contract (every data schema,
// the step catalog, this app's version) and, alongside it rather than
// merged into it (goal 0160), mill://skill (the practice doc: which
// tool fits which job, how approvals behave). Split out of
// SettingsView.tsx once that file crossed the 500-line convention
// (CLAUDE.md), the same seam KeyboardShortcutsSection/UpdatesSection/
// DataStewardshipSection already extract along.
export default function ContractSection() {
  const { t } = useTranslation('views')
  const [contractExportError, setContractExportError] = useState('')
  const [skillExportError, setSkillExportError] = useState('')
  const [auditExportError, setAuditExportError] = useState('')

  // Same fetch-JSON-then-download-a-blob shape as CompositionView's own
  // exportWorkflow -- one file, no server round trip beyond the RPC
  // itself.
  const exportContract = () => {
    setContractExportError('')
    SettingsService.ExportContract()
      .then((json) => {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'mill-contract.json'
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => setContractExportError(t('settings.contract.exportError')))
  }

  const exportSkillDoc = () => {
    setSkillExportError('')
    SettingsService.ExportSkillDoc()
      .then((markdown) => {
        const blob = new Blob([markdown], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'mill-skill.md'
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => setSkillExportError(t('settings.contract.exportSkillError')))
  }

  // The one export door over EVERY guarded surface's shared trail
  // (goal 0351 Decision 5) -- kinds=[] means every kind, same
  // fetch-then-download shape as the two exports above.
  const exportAuditTrail = () => {
    setAuditExportError('')
    AuditService.ExportAuditTrail([])
      .then((jsonLines) => {
        const blob = new Blob([jsonLines], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'mill-audit-trail.jsonl'
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => setAuditExportError(t('settings.contract.exportAuditError')))
  }

  return (
    <>
      <Text as="p" size="small" className={styles.muted}>
        {t('settings.contract.description')}
      </Text>
      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
        <Button size="small" onClick={exportContract} data-testid="export-contract">
          {t('settings.contract.exportButton')}
        </Button>
      </Stack>
      {contractExportError && (
        <Text as="p" size="small" className={styles.error}>{contractExportError}</Text>
      )}
      <Text as="p" size="small" className={styles.muted} style={{ marginTop: 'var(--base-size-16)' }}>
        {t('settings.contract.exportSkillDescription')}
      </Text>
      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
        <Button size="small" onClick={exportSkillDoc} data-testid="export-skill-doc">
          {t('settings.contract.exportSkillButton')}
        </Button>
      </Stack>
      {skillExportError && (
        <Text as="p" size="small" className={styles.error}>{skillExportError}</Text>
      )}
      <Text as="p" size="small" className={styles.muted} style={{ marginTop: 'var(--base-size-16)' }}>
        {t('settings.contract.exportAuditDescription')}
      </Text>
      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
        <Button size="small" onClick={exportAuditTrail} data-testid="export-audit-trail">
          {t('settings.contract.exportAuditButton')}
        </Button>
      </Stack>
      {auditExportError && (
        <Text as="p" size="small" className={styles.error}>{auditExportError}</Text>
      )}
    </>
  )
}
