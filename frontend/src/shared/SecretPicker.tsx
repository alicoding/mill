import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select, Stack, Text } from '@primer/react'
import { refreshSecretTitles, useSecretTitles } from './secretTitleCache'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import { SecretsEntryDialog } from './SecretsEntryDialog'
import { toEntryID, toReference } from './secretReference'
import styles from './ListCard.module.css'

// The one control every secret-shaped field uses (goal 0306): a select
// over what the store holds -- the reference is what persists, the
// title is what shows, and the value is never here at all. Beside it,
// the two ways to get a secret that is not in the store yet: add one,
// or name a key in a configured source. Both open the store's own
// entry form, so there is one place an entry is authored.
//
// A picked entry that has since been deleted stays selectable-as-is
// (so the row can say what happened) with the "pick another" caption;
// a store that cannot be listed says so instead of offering an empty
// list.

// kindsOf lists the entry kinds a field accepts. A field that states
// none accepts anything, which is what a general-purpose picker (a
// plugin's secretRef setting) wants.
export type SecretPickerProps = {
  value: string
  onChange: (reference: string) => void
  kinds?: Kind[]
  // newEntryTitle prefills the title when someone adds a secret from
  // this field, so an entry created here says what it is for.
  newEntryTitle?: string
  // ariaLabel names the select for anything reading the page by label.
  // A FormControl.Label cannot reach it on its own: this is a compound
  // control (a select beside a button), and Primer only auto-associates
  // a label with a single input child.
  ariaLabel?: string
  testID?: string
}

// SecretPicker deals in REFERENCES: what it hands back is exactly what
// an entity's field stores and the secret service resolves.
export function SecretPicker({ value, onChange, kinds, newEntryTitle, ariaLabel, testID }: SecretPickerProps) {
  const { t } = useTranslation('views')
  const { titles, kinds: entryKinds, error, loaded } = useSecretTitles()
  const [adding, setAdding] = useState<Kind | null>(null)
  // Refreshed on every mount, not just the first: an entry added in
  // the Secrets view, or by another field's own Add, has to be on
  // offer here without a reload.
  useEffect(() => {
    void refreshSecretTitles()
  }, [])

  const selected = toEntryID(value)
  const accepts = (id: string) => kinds === undefined || kinds.includes(entryKinds[id] ?? Kind.KindText)
  const ids = Object.keys(titles).filter(accepts)
  const vaultIDs = ids.filter((id) => !id.includes(':'))
  const sourceIDs = ids.filter((id) => id.includes(':'))
  const gone = selected !== '' && loaded && !error && titles[selected] === undefined

  return (
    <>
      <Stack direction="horizontal" gap="condensed" align="center">
        <Select
          value={selected}
          onChange={(e) => onChange(toReference(e.target.value))}
          aria-label={ariaLabel}
          data-testid={testID ?? 'secret-ref-picker'}
        >
          <Select.Option value="">{t('settings.extensions.secretRefNone')}</Select.Option>
          <Select.OptGroup label={t('settings.extensions.secretRefGroupVault')}>
            {vaultIDs.map((id) => <Select.Option key={id} value={id}>{titles[id]}</Select.Option>)}
          </Select.OptGroup>
          {sourceIDs.length > 0 && (
            <Select.OptGroup label={t('settings.extensions.secretRefGroupSources')}>
              {sourceIDs.map((id) => <Select.Option key={id} value={id}>{titles[id]}</Select.Option>)}
            </Select.OptGroup>
          )}
          {gone && <Select.Option value={selected}>{t('settings.extensions.secretRefGone')}</Select.Option>}
        </Select>
        <Button size="small" onClick={() => setAdding(kinds?.[0] ?? Kind.KindText)} data-testid="secret-ref-add">
          {t('settings.extensions.secretRefAdd')}
        </Button>
      </Stack>
      {gone && (
        <Text as="p" size="small" className={styles.attention} data-testid="secret-ref-gone">{t('settings.extensions.secretRefGone')}</Text>
      )}
      {error && (
        <Text as="p" size="small" className={styles.muted} data-testid="secret-ref-unavailable">{t('settings.extensions.secretRefUnavailable')}</Text>
      )}
      {adding !== null && (
        <SecretsEntryDialog
          editID={null}
          defaultTitle={newEntryTitle}
          defaultKind={adding}
          onClose={() => setAdding(null)}
          onSaved={(id) => { setAdding(null); onChange(toReference(id)) }}
        />
      )}
    </>
  )
}

// SecretRefPicker is the plugin-facing wrapper (ADR-0048): a plugin's
// secretRef setting stores the bare entry id rather than a reference,
// so the conversion lives here, once, instead of every field having to
// know which of the two shapes it holds.
export function SecretRefPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return <SecretPicker value={toReference(value)} onChange={(ref) => onChange(toEntryID(ref))} />
}
