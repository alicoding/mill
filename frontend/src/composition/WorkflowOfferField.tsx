import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import { ReferencePeek } from '../configure/ReferencePeek'
import runbookStyles from '../shared/ListCard.module.css'

// Where a workflow shows up as an action on Atlas cards (goal 0328). The
// value is an integration's id, and picking one is a decision about
// WHICH cards get the action -- so every row says which cards it means,
// including the first row, which means none of them.
//
// A descriptive list, not the plain entity picker: a native <select> can
// only render one line per option, and the row's own sub-line is what
// makes "Nowhere" read as a real choice rather than an empty field. The
// reference peek under it is unchanged.
interface Integration {
  ID: string
  Label: string
}

export function WorkflowOfferField({ value, onChange, readOnly }: {
  value: string
  onChange: (requestID: string) => void
  readOnly: boolean
}) {
  const { t } = useTranslation('composition')
  const [integrations, setIntegrations] = useState<Integration[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ConfigureService.HTTPRequests()
      .then((list) => setIntegrations(list ?? []))
      .catch((err) => setError(String(err)))
  }, [])

  const selected = integrations?.find((i) => i.ID === value) ?? null
  const buttonLabel = selected ? selected.Label : t('workflowOffer.nowhere')

  return (
    <>
      {readOnly ? (
        <Text as="p" size="small" style={{ margin: 0 }} data-testid="workflow-offer-value">{buttonLabel}</Text>
      ) : (
        <ActionMenu>
          <ActionMenu.Button size="small" data-testid="workflow-offer-picker">{buttonLabel}</ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList selectionVariant="single">
              <ActionList.Item selected={!selected} data-testid="workflow-offer-nowhere" onSelect={() => onChange('')}>
                {t('workflowOffer.nowhere')}
                <ActionList.Description variant="block">{t('workflowOffer.nowhereDescription')}</ActionList.Description>
              </ActionList.Item>
              {(integrations ?? []).map((integration) => (
                <ActionList.Item
                  key={integration.ID}
                  selected={integration.ID === value}
                  data-testid="workflow-offer-option"
                  onSelect={() => onChange(integration.ID)}
                >
                  {integration.Label}
                  <ActionList.Description variant="block">
                    {t('workflowOffer.optionDescription', { label: integration.Label })}
                  </ActionList.Description>
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
      <ReferencePeek refKind="request" id={selected ? value : ''} noun={t('workflowOffer.noun')} />
      {error && <Text as="p" size="small" className={runbookStyles.error}>{error}</Text>}
    </>
  )
}
