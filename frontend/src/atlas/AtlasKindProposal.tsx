import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, FormControl, Select, Stack, Text, TextInput } from '@primer/react'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { FIELD_TYPES } from './AtlasKindEditor'
import { type KindProposalState, type ProposalFieldState } from './atlasKindProposalLogic'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasKindProposal.module.css'

// The Kind picker's own sentinel value, and every pure state-shaping
// helper this panel needs, live in atlasKindProposalLogic.ts (unit-
// tested standalone there) -- re-exported here too so an existing
// import of `./AtlasKindProposal` (AtlasFolderImport.tsx) keeps working
// unchanged.
export { CREATE_KIND_OPTION, buildProposalFields, initialProposalState, proposalNameTaken } from './atlasKindProposalLogic'
export type { KindProposalState, ProposalFieldState } from './atlasKindProposalLogic'

// AtlasKindProposal is the inline panel goal 0172 S2 adds beneath a
// scan category's own Kind picker, once "Create a new type from these
// files" is selected -- never a second dialog, so the file accept/
// reject checkboxes above it stay visible while the user decides the
// type. Purely controlled: every edit flows back through onChange,
// AtlasFolderImport.tsx owns the actual state.
export function AtlasKindProposal({ value, onChange, nameTaken }: {
  value: KindProposalState
  onChange: (next: KindProposalState) => void
  // Lifted to the parent (rather than recomputed with useState here)
  // so Confirm's own disabled condition can read the SAME check this
  // panel renders, with no risk of the two drifting out of sync.
  nameTaken: boolean
}) {
  const { t } = useTranslation('atlas')
  // Blur-driven, not live-while-typing (delivery-discipline.md's
  // integration-surfaces triage, interaction primitives item):
  // flashing an error on every keystroke would fire while the name is
  // still mid-edit toward a perfectly valid value.
  const [nameTouched, setNameTouched] = useState(false)

  const setField = (i: number, patch: Partial<ProposalFieldState>) => {
    onChange({ ...value, fields: value.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  }

  return (
    <Stack gap="condensed" className={styles.panel} data-testid="atlas-kind-proposal">
      <Text as="p" weight="semibold" size="small">{t('folderImport.proposal.heading')}</Text>

      {value.fields.length === 0 ? (
        <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-kind-proposal-no-fields">
          {t('folderImport.proposal.noFieldsFound')}
        </Text>
      ) : (
        <>
          <Text as="p" size="small" className={runbookStyles.muted}>{t('folderImport.proposal.caption')}</Text>
          <FormControl>
            <FormControl.Label>{t('folderImport.proposal.nameLabel')}</FormControl.Label>
            <TextInput
              size="small"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              onBlur={() => setNameTouched(true)}
              data-testid="atlas-kind-proposal-name"
            />
            {nameTouched && nameTaken && (
              <FormControl.Validation variant="error" data-testid="atlas-kind-proposal-name-taken">
                {t('folderImport.proposal.nameTaken')}
              </FormControl.Validation>
            )}
          </FormControl>

          <div className={styles.columnLabels}>
            <span>{t('folderImport.proposal.columnInclude')}</span>
            <span>{t('folderImport.proposal.columnKey')}</span>
            <span>{t('folderImport.proposal.columnShowsAs')}</span>
            <span>{t('folderImport.proposal.columnType')}</span>
            <span>{t('folderImport.proposal.columnOnCard')}</span>
          </div>

          {value.fields.map((f, i) => (
            <div key={f.key} className={styles.fieldRow} data-testid="atlas-kind-proposal-field-row" data-included={f.include}>
              <Checkbox
                checked={f.include}
                aria-label={t('folderImport.proposal.columnInclude')}
                onChange={(e) => setField(i, { include: e.target.checked })}
                data-testid="atlas-kind-proposal-field-include"
              />
              <Text size="small" className={styles.fieldKey} data-testid="atlas-kind-proposal-field-key">{f.key}</Text>
              <TextInput
                size="small"
                aria-label={t('folderImport.proposal.columnShowsAs')}
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                data-testid="atlas-kind-proposal-field-label"
              />
              <Select
                size="small"
                aria-label={t('folderImport.proposal.columnType')}
                value={f.type}
                onChange={(e) => setField(i, { type: e.target.value as FieldType })}
                data-testid="atlas-kind-proposal-field-type"
              >
                {FIELD_TYPES.map((ft) => (
                  <Select.Option key={ft.value} value={ft.value}>{t(ft.labelKey)}</Select.Option>
                ))}
              </Select>
              <Checkbox
                checked={f.showOnCard}
                aria-label={t('folderImport.proposal.columnOnCard')}
                onChange={(e) => setField(i, { showOnCard: e.target.checked })}
                data-testid="atlas-kind-proposal-field-showoncard"
              />
            </div>
          ))}

          <Stack gap="condensed" className={styles.statusSection}>
            <FormControl>
              <Checkbox
                checked={value.statusEnabled}
                onChange={(e) => onChange({ ...value, statusEnabled: e.target.checked })}
                data-testid="atlas-kind-proposal-status-toggle"
              />
              <FormControl.Label>{t('folderImport.proposal.statusToggle')}</FormControl.Label>
              <FormControl.Caption>{t('folderImport.proposal.statusCaption')}</FormControl.Caption>
            </FormControl>
            {value.statusEnabled && (
              <FormControl>
                <FormControl.Label>{t('folderImport.proposal.statusValuesLabel')}</FormControl.Label>
                <TextInput
                  size="small"
                  value={value.statusValues}
                  onChange={(e) => onChange({ ...value, statusValues: e.target.value })}
                  data-testid="atlas-kind-proposal-status-values"
                />
              </FormControl>
            )}
          </Stack>
        </>
      )}
    </Stack>
  )
}
