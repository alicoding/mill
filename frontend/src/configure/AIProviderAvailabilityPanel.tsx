import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, SelectPanel, Stack, Text } from '@primer/react'
import type { SelectPanelItemInput } from '@primer/react'
import { PlayIcon, TriangleDownIcon } from '@primer/octicons-react'
import { AdvancedDisclosure } from '../shared/AdvancedDisclosure'
import { ConfigureService, CompositionService } from '../shared/bindings'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'
import { useAppStore } from '../shared/store'
import { refreshAIProviderAvailability } from '../shared/configureEntityStore'
import type { AIProvider, OperationFeature, Report, SamplePreview } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { CheckStatus, EvidenceSource, Freshness, Operation, SampleStatus, Support } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { aiProviderConnectionState } from './aiProviderConnectionState'
import styles from '../shared/ListCard.module.css'
import { messageFor } from '../shared/userError'
import { writeClipboardText } from '../shared/clipboardWrite'

const operationKeys: Record<Operation, string> = {
  [Operation.$zero]: 'text',
  [Operation.OperationText]: 'text',
  [Operation.OperationStructured]: 'structured',
  [Operation.OperationClassification]: 'classification',
}

function stampFor(feature?: OperationFeature): { variant: StatusStampVariant; key: string } {
  if (!feature) return { variant: 'neutral', key: 'unverified' }
  if (feature.lastSampleSuccess?.freshness === Freshness.FreshnessFresh) return { variant: 'success', key: 'tested' }
  if (feature.lastSampleAttempt) return { variant: 'danger', key: 'testFailed' }
  if (feature.support === Support.SupportUnsupported) return { variant: 'danger', key: 'unsupported' }
  if (feature.evidence === EvidenceSource.EvidenceProviderMetadata) return { variant: 'neutral', key: 'advertised' }
  return { variant: 'neutral', key: 'unverified' }
}

const operations = [Operation.OperationText, Operation.OperationStructured, Operation.OperationClassification]

export function AIProviderAvailabilityPanel({ provider, report, dirty, choicesCurrent, model, onModelChange }: {
  provider: AIProvider
  report?: Report
  dirty: boolean
  choicesCurrent: boolean
  model: string
  onModelChange: (model: string) => void
}) {
  const { t } = useTranslation('configure')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sample, setSample] = useState<SamplePreview | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  const state = aiProviderConnectionState(report)
  const active = report?.lifecycle === CheckStatus.CheckAwaitingApproval || report?.lifecycle === CheckStatus.CheckChecking
  const modelItems: SelectPanelItemInput[] = (report?.modelChoices ?? []).map((choice) => ({ id: choice.id, text: choice.id }))
  const filteredModels = modelFilter ? modelItems.filter((item) => item.text?.toLowerCase().includes(modelFilter.toLowerCase())) : modelItems
  const selectedModel = modelItems.find((item) => item.id === model)
  const hasCheckedAt = report?.lifecycle !== CheckStatus.CheckNotStarted && !!report?.checkedAt && !report.checkedAt.startsWith('0001-')

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refreshAIProviderAvailability()
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  const prepareSample = async (operation: Operation, restore = false) => {
    setBusy(true)
    setError('')
    try {
      const preview = restore
        ? await CompositionService.RestoreAIProviderFeatureSample(provider.ID, operation)
        : await CompositionService.PrepareAIProviderFeatureSample(provider.ID, operation)
      setSample(preview)
      if (preview.status !== SampleStatus.SampleStatusModified) requestOpenWorkflow(preview.workflowID)
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdvancedDisclosure open={false} testId="aiprovider-availability" summary={t('configureAIProviders.availability.heading')}>
      <Stack direction="vertical" gap="condensed">
        <Stack direction="horizontal" gap="condensed" align="center" aria-live="polite">
          <StatusStamp variant={state === 'responded' || state === 'notChecked' ? 'neutral' : 'caution'}>
            {t(`configureAIProviders.availability.connection.${state}`)}
          </StatusStamp>
          {report?.freshness === Freshness.FreshnessStale && <StatusStamp variant="caution">{t('configureAIProviders.availability.previousCheck')}</StatusStamp>}
          {hasCheckedAt && <Text size="small" className={styles.muted}>{t('configureAIProviders.availability.checkedAt', { date: new Date(report.checkedAt).toLocaleString() })}</Text>}
        </Stack>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text as="p" size="small"><strong>{t('configureAIProviders.availability.address')}</strong> {report?.checkedEndpoint || provider.BaseURL || t('configureAIProviders.availability.defaultAddress')}</Text>
          <Button size="small" variant="invisible" onClick={() => void writeClipboardText(report?.checkedEndpoint || provider.BaseURL).then(() => setCopied(true)).catch((err) => setError(messageFor(err, t)))}>{copied ? t('configureAIProviders.availability.copied') : t('configureAIProviders.availability.copyAddress')}</Button>
        </Stack>
        <Text as="p" size="small"><strong>{t('configureAIProviders.availability.model')}</strong> {model}</Text>
        <SelectPanel
          title={t('configureAIProviders.availability.chooseModel')}
          placeholder={t('configureAIProviders.availability.filterModels')}
          open={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          items={filteredModels}
          selected={selectedModel}
          onSelectedChange={(next) => { if (next) onModelChange(String(next.id)) }}
          filterValue={modelFilter}
          onFilterChange={setModelFilter}
          message={report && modelItems.length === 0 ? { title: t('configureAIProviders.availability.noModels'), body: t('configureAIProviders.availability.enterModelManually'), variant: 'empty' } : undefined}
          renderAnchor={(props) => <Button {...props} size="small" disabled={!choicesCurrent} trailingAction={TriangleDownIcon}>{t('configureAIProviders.availability.chooseModel')}</Button>}
        />
        <Text as="p" size="small"><strong>{t('configureAIProviders.availability.executionLocation')}</strong> {t('configureAIProviders.availability.unknown')}</Text>
        <Text as="p" size="small" className={styles.muted}>{t('configureAIProviders.availability.forwarding')}</Text>
        {dirty && <Text as="p" size="small" className={styles.attention}>{t('configureAIProviders.availability.saveBeforeCheck')}</Text>}
        <Stack direction="horizontal" gap="condensed">
          {!active && <Button size="small" disabled={dirty || busy || state === 'notAllowed'} onClick={() => void run(() => ConfigureService.StartAIProviderCheck(provider.ID))}>{t('configureAIProviders.availability.check')}</Button>}
          {active && <Button size="small" disabled={busy} onClick={() => void run(() => ConfigureService.CancelAIProviderCheck(provider.ID, report?.checkId ?? ''))}>{t('configureAIProviders.availability.cancelCheck')}</Button>}
          {report?.lifecycle === CheckStatus.CheckAwaitingApproval && <Button size="small" variant="invisible" onClick={() => useAppStore.getState().setView({ kind: 'review' })}>{t('configureAIProviders.availability.review')}</Button>}
        </Stack>
        <Text size="small" weight="semibold">{t('configureAIProviders.availability.features')}</Text>
        <ActionList data-testid="aiprovider-features">
          {operations.map((operation) => {
            const feature = report?.operations?.find((item) => item.operation === operation)
            const stamp = stampFor(feature)
            const opKey = operationKeys[operation]
            return (
              <ActionList.Item key={operation} data-testid={`aiprovider-feature-${operation}`}>
                {t(`configureAIProviders.availability.operation.${opKey}`)}
                <ActionList.Description variant="block">
                  <StatusStamp variant={stamp.variant}>{t(`configureAIProviders.availability.evidence.${stamp.key}`)}</StatusStamp>
                  {feature?.lastSampleSuccess?.checkedAt && ` ${new Date(feature.lastSampleSuccess.checkedAt).toLocaleString()}`}
                </ActionList.Description>
                <ActionList.TrailingAction as="button" icon={PlayIcon} label={t('configureAIProviders.availability.testFeature')} aria-disabled={dirty || busy} onClick={(event: React.MouseEvent) => { event.stopPropagation(); if (!dirty && !busy) void prepareSample(operation) }} />
              </ActionList.Item>
            )
          })}
        </ActionList>
        <Text as="p" size="small" className={styles.attention}>{t('configureAIProviders.availability.mayCharge')}</Text>
        {sample && (
          <Stack direction="vertical" gap="condensed" className={sample.status === SampleStatus.SampleStatusModified ? styles.attention : styles.card}>
            {sample.status === SampleStatus.SampleStatusModified ? (
              <>
                <Text as="p" size="small">{t('configureAIProviders.availability.sampleModified')}</Text>
                <Button size="small" disabled={busy} onClick={() => void prepareSample(sample.operation, true)}>{t('configureAIProviders.availability.restoreSample')}</Button>
              </>
            ) : (
              <>
                <Text as="p" size="small">{t('configureAIProviders.availability.sampleReady')}</Text>
                <Text as="p" size="small">{t('configureAIProviders.availability.syntheticInput', { input: sample.syntheticInput })}</Text>
                <Text as="p" size="small">{t('configureAIProviders.availability.sampleDestination', { provider: provider.Label, model: sample.model, address: sample.safeDestination })}</Text>
                <Text as="p" size="small" className={styles.attention}>{t('configureAIProviders.availability.mayCharge')}</Text>
              </>
            )}
          </Stack>
        )}
        {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      </Stack>
    </AdvancedDisclosure>
  )
}
