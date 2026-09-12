import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, SelectPanel, Stack, Text } from '@primer/react'
import type { SelectPanelItemInput } from '@primer/react'
import { PlayIcon, TriangleDownIcon } from '@primer/octicons-react'
import { AdvancedDisclosure } from '../shared/AdvancedDisclosure'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'
import { useConfigureEntityStore } from '../shared/configureEntityStore'
import type { AIProvider, OperationFeature, Report, SamplePreview } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { AuthenticationStatus, CheckStatus, EvidenceSource, Freshness, InspectionStatus, Operation, PermissionStatus, SampleStatus, Support } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { aiProviderConnectionState } from './aiProviderConnectionState'
import styles from '../shared/ListCard.module.css'
import { runCommand } from '../shared/commands'
import { entityRowContext } from '../shared/entityRowCommands'

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

function metadataKeyFor(report?: Report): string {
  if (report?.inspection === InspectionStatus.InspectionAvailable) return 'available'
  if (report?.inspection === InspectionStatus.InspectionUnsupported) return 'unavailable'
  if (report?.inspection === InspectionStatus.InspectionFailed) return 'failed'
  return 'notChecked'
}

function authorizationKeyFor(report?: Report): string {
  if (report?.authentication === AuthenticationStatus.AuthenticationNotRequired) return 'notRequired'
  if (report?.authentication === AuthenticationStatus.AuthenticationRejected) return 'rejected'
  if (report?.authentication === AuthenticationStatus.AuthenticationMetadataAuthorized || report?.authentication === AuthenticationStatus.AuthenticationOperationTested) return 'authorized'
  return 'unknown'
}

function permissionKeyFor(report?: Report): string {
  if (report?.permission.status === PermissionStatus.PermissionAllowed) return 'allowed'
  if (report?.permission.status === PermissionStatus.PermissionDenied) return 'denied'
  return 'unchecked'
}

const operations = [Operation.OperationText, Operation.OperationStructured, Operation.OperationClassification]

const reasonKeys: Record<string, string> = {
  'metadata-api-unsupported': 'metadataUnavailable',
  'metadata-response-malformed': 'metadataUnreadable',
  'metadata-response-too-large': 'metadataUnreadable',
  'metadata-auth-rejected': 'metadataRejected',
  'metadata-rate-limited': 'metadataRateLimited',
  'metadata-redirect-refused': 'metadataRedirectRefused',
  'metadata-service-failed': 'metadataFailed',
  'metadata-http-failed': 'metadataFailed',
  'invalid-endpoint': 'invalidEndpoint',
  'unknown-provider-kind': 'unknownProtocol',
  'permission-denied': 'permissionDenied',
  'policy-service-unwired': 'permissionUnavailable',
  'policy-check-failed': 'permissionUnavailable',
  'secret-resolution-failed': 'secretUnavailable',
  'configuration-changed': 'configurationChanged',
  'secret-source-changed': 'secretChanged',
  'check-cancelled': 'checkCancelled',
  'check-timed-out': 'checkTimedOut',
  'service-stopped': 'serviceStopped',
  'selected-model-not-listed': 'modelNotListed',
  'selected-model-missing': 'modelNotListed',
  'selected-model-unverified': 'modelUnverified',
  'metadata-inventory-incomplete': 'inventoryIncomplete',
  'operation-not-proven-by-metadata': 'operationUnverified',
}

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
  const sample: SamplePreview | undefined = useConfigureEntityStore((s) => s.aiProviderSamplePreviews[provider.ID])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const state = aiProviderConnectionState(report)
  const active = report?.lifecycle === CheckStatus.CheckAwaitingApproval || report?.lifecycle === CheckStatus.CheckChecking
  const modelItems: SelectPanelItemInput[] = (report?.modelChoices ?? []).map((choice) => ({ id: choice.id, text: choice.id }))
  const filteredModels = modelFilter ? modelItems.filter((item) => item.text?.toLowerCase().includes(modelFilter.toLowerCase())) : modelItems
  const selectedModel = modelItems.find((item) => item.id === model)
  const hasCheckedAt = report?.lifecycle !== CheckStatus.CheckNotStarted && !!report?.checkedAt && !report.checkedAt.startsWith('0001-')

  const run = async (commandId: string) => {
    setBusy(true)
    try {
      await runCommand(commandId, entityRowContext('aiprovider', provider.ID))
    } finally {
      setBusy(false)
    }
  }

  const reportReasons = (report?.reasonCodes ?? []).map((code) => t(`configureAIProviders.availability.reason.${reasonKeys[code] ?? 'other'}`))
  const metadataKey = metadataKeyFor(report)
  const authKey = authorizationKeyFor(report)
  const permissionKey = permissionKeyFor(report)

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
          <Button size="small" variant="invisible" onClick={() => void runCommand('configure.aiprovider.copyAddress', entityRowContext('aiprovider', provider.ID)).then((ok) => setCopied(ok))}>{copied ? t('configureAIProviders.availability.copied') : t('configureAIProviders.availability.copyAddress')}</Button>
        </Stack>
        <Text as="p" size="small"><strong>{t('configureAIProviders.availability.metadata')}</strong> {t(`configureAIProviders.availability.metadataState.${metadataKey}`)}</Text>
        <Text as="p" size="small"><strong>{t('configureAIProviders.availability.authorization')}</strong> {t(`configureAIProviders.availability.authorizationState.${authKey}`)}</Text>
        <Text as="p" size="small"><strong>{t('configureAIProviders.availability.permission')}</strong> {report?.permission.ruleLabel || t(`configureAIProviders.availability.permissionState.${permissionKey}`)}</Text>
        {reportReasons.map((reason, index) => <Text as="p" size="small" className={styles.muted} key={`${reason}-${index}`}>{reason}</Text>)}
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
          {!active && <Button size="small" disabled={dirty || busy || state === 'notAllowed'} onClick={() => void run('configure.aiprovider.check')}>{t('configureAIProviders.availability.check')}</Button>}
          {active && <Button size="small" disabled={busy} onClick={() => void run('configure.aiprovider.cancelCheck')}>{t('configureAIProviders.availability.cancelCheck')}</Button>}
          {report?.lifecycle === CheckStatus.CheckAwaitingApproval && <Button size="small" variant="invisible" onClick={() => void runCommand('view.review')}>{t('configureAIProviders.availability.review')}</Button>}
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
                  {(feature?.reasonCodes ?? []).map((code) => <Text as="span" size="small" className={styles.muted} key={code}> · {t(`configureAIProviders.availability.reason.${reasonKeys[code] ?? 'other'}`)}</Text>)}
                  {feature?.lastSampleSuccess && <Text as="span" size="small" className={styles.muted}> · {t('configureAIProviders.availability.sampleScope', { version: feature.lastSampleSuccess.sampleVersion })}</Text>}
                </ActionList.Description>
                <ActionList.TrailingAction as="button" icon={PlayIcon} label={t('configureAIProviders.availability.testFeature')} aria-disabled={dirty || busy} onClick={(event: React.MouseEvent) => { event.stopPropagation(); if (!dirty && !busy) void run(`configure.aiprovider.test.${operation}`) }} />
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
                <Button size="small" disabled={busy} onClick={() => void run(`configure.aiprovider.restore.${sample.operation}`)}>{t('configureAIProviders.availability.restoreSample')}</Button>
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
      </Stack>
    </AdvancedDisclosure>
  )
}
