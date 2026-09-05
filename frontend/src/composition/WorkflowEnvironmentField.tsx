import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import { ReferencePeek } from '../configure/ReferencePeek'
import runbookStyles from '../shared/ListCard.module.css'

// Which Environment a workflow's runs target (goal 0306 S5). The same
// descriptive-list shape WorkflowOfferField uses, for the same reason:
// the first row means "no environment," and a plain empty select
// cannot say that a run then substitutes nothing.
interface EnvironmentOption {
  ID: string
  Label: string
}

export function WorkflowEnvironmentField({ value, onChange, readOnly }: {
  value: string
  onChange: (environmentID: string) => void
  readOnly: boolean
}) {
  const { t } = useTranslation('composition')
  const [environments, setEnvironments] = useState<EnvironmentOption[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ConfigureService.Environments()
      .then((list) => setEnvironments(list ?? []))
      .catch((err) => setError(String(err)))
  }, [])

  const selected = environments?.find((e) => e.ID === value) ?? null
  const buttonLabel = selected ? selected.Label : t('workflowEnvironment.none')

  return (
    <>
      {readOnly ? (
        <Text as="p" size="small" style={{ margin: 0 }} data-testid="workflow-environment-value">{buttonLabel}</Text>
      ) : (
        <ActionMenu>
          <ActionMenu.Button size="small" data-testid="workflow-environment-picker">{buttonLabel}</ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="single">
              <ActionList.Item selected={!selected} data-testid="workflow-environment-none" onSelect={() => onChange('')}>
                {t('workflowEnvironment.none')}
                <ActionList.Description variant="block">{t('workflowEnvironment.noneDescription')}</ActionList.Description>
              </ActionList.Item>
              {(environments ?? []).map((environment) => (
                <ActionList.Item
                  key={environment.ID}
                  selected={environment.ID === value}
                  data-testid="workflow-environment-option"
                  onSelect={() => onChange(environment.ID)}
                >
                  {environment.Label}
                  <ActionList.Description variant="block">
                    {t('workflowEnvironment.optionDescription', { label: environment.Label })}
                  </ActionList.Description>
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
      <ReferencePeek refKind="environment" id={selected ? value : ''} noun={t('workflowEnvironment.noun')} />
      {error && <Text as="p" size="small" className={runbookStyles.error}>{error}</Text>}
    </>
  )
}
