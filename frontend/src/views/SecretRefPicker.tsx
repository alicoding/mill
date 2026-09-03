import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, Text } from '@primer/react'
import { refreshSecretTitles, useSecretTitles } from '../shared/secretTitleCache'
import styles from '../shared/ListCard.module.css'

// The secretRef setting's host control (ADR-0048): a select over the
// vault's titles -- the id is what persists, the title is what shows,
// and the value is never here at all. A picked entry that has since
// been deleted stays selectable-as-is (so the row can say what
// happened) with the "pick another" caption; a vault that cannot be
// listed says so instead of offering an empty list.
export function SecretRefPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation('views')
  const { titles, error, loaded } = useSecretTitles()
  useEffect(() => {
    if (!loaded) void refreshSecretTitles()
  }, [loaded])
  const gone = value !== '' && loaded && !error && titles[value] === undefined
  return (
    <>
      <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid="secret-ref-picker">
        <Select.Option value="">{t('settings.extensions.secretRefNone')}</Select.Option>
        {Object.entries(titles).map(([id, title]) => <Select.Option key={id} value={id}>{title}</Select.Option>)}
        {gone && <Select.Option value={value}>{t('settings.extensions.secretRefGone')}</Select.Option>}
      </Select>
      {gone && (
        <Text as="p" size="small" className={styles.attention} data-testid="secret-ref-gone">{t('settings.extensions.secretRefGone')}</Text>
      )}
      {error && (
        <Text as="p" size="small" className={styles.muted} data-testid="secret-ref-unavailable">{t('settings.extensions.secretRefUnavailable')}</Text>
      )}
    </>
  )
}
