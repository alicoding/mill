import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Stack, Text } from '@primer/react'
import { AlertIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import type { ReferenceSummary } from '../../bindings/github.com/alicoding/mill/internal/services/configuresvc/models'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { SUMMARY_KINDS, referenceOpenTarget } from './referenceTarget'
import styles from '../shared/ListCard.module.css'
import peekStyles from './ReferencePeek.module.css'

// The reference peek (goal 0312): under a reference field, what the
// chosen entity IS (Details, an inline dismissable summary from
// DescribeReference) and a way to it (Open: the entity's own editor --
// a work tab for an integration or a workflow, the Configure tab with
// its form opened for every other kind). A problem the entity's own
// checks know (a missing secret, a vanished vault entry) shows on the
// field without opening Details, beside the same Open door. The Open
// link is object-scoped (this field's own entity) and so mouse-only,
// the same reason the plugin menu items give.
export function ReferencePeek({ refKind, id }: { refKind: string; id: string }) {
  const { t } = useTranslation('configure')
  const [summary, setSummary] = useState<ReferenceSummary | null>(null)
  const [open, setOpen] = useState(false)
  const target = referenceOpenTarget(refKind, id)
  const summarizable = SUMMARY_KINDS.has(refKind)

  useEffect(() => {
    setSummary(null)
    setOpen(false)
    if (!id || !summarizable) return
    let live = true
    ConfigureService.DescribeReference(refKind, id)
      .then((s) => { if (live) setSummary(s) })
      .catch(() => { if (live) setSummary(null) })
    return () => { live = false }
  }, [refKind, id, summarizable])

  if (!target) return null

  const openTarget = () => {
    if (target.kind === 'work-tab') {
      useAppStore.getState().openWorkTab(target.spec)
      return
    }
    useUISignalStore.getState().requestConfigureEdit(target.tab, id)
    useAppStore.getState().setView({ kind: 'configure', tab: target.tab })
  }
  const openLabel = refKind === 'request' ? t('entityRefField.openIntegration') : refKind === 'workflow' || refKind === 'workflow-scope' ? t('entityRefField.openWorkflow') : t('entityRefField.openInConfigure')
  const problems = summary?.problems ?? []

  return (
    <Stack direction="vertical" gap="none" data-testid="entity-ref-peek">
      {problems.map((p) => (
        <Stack key={p} direction="horizontal" gap="condensed" align="center" data-testid="entity-ref-problem">
          <AlertIcon size={14} className={styles.attention} />
          <Text size="small">{p}</Text>
        </Stack>
      ))}
      <Text size="small" className={styles.muted}>
        {summarizable && (
          <>
            <Link href="#" onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }} data-testid="entity-ref-details">
              {open ? t('entityRefField.hideDetails') : t('entityRefField.details')}
            </Link>
            {' · '}
          </>
        )}
        <Link href="#" onClick={(e) => { e.preventDefault(); openTarget() }} data-testid="entity-ref-open">{openLabel}</Link>
      </Text>
      {open && summary && (
        <dl className={peekStyles.summary} data-testid="entity-ref-summary">
          {(summary.lines ?? []).map((l) => (
            <div key={l.label} className={peekStyles.row}>
              <dt>{l.label}</dt>
              <dd>{l.value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </Stack>
  )
}
