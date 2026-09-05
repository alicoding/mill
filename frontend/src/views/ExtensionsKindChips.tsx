import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { kindLabelKey } from './extensionTrust'
import styles from './ExtensionsSection.module.css'

// Filter by what an extension ADDS (docs/goals/0349). The vocabulary
// is the manifest's own contribution families, read from the backend
// rather than restated here -- a new family in the manifest puts a
// chip here with no edit to this file.
export function ExtensionsKindChips({ selected, onChange }: {
  selected: string[]
  onChange: (kinds: string[]) => void
}) {
  const { t } = useTranslation('views')
  const [kinds, setKinds] = useState<string[]>([])

  useEffect(() => {
    PluginService.ContributionVocabulary().then((v) => setKinds(v ?? [])).catch(() => setKinds([]))
  }, [])

  const shown = kinds.filter((kind) => kindLabelKey(kind) !== null)
  if (shown.length === 0) return null

  const toggle = (kind: string) => {
    onChange(selected.includes(kind) ? selected.filter((k) => k !== kind) : [...selected, kind])
  }

  return (
    <div className={styles.kindChips} role="group" aria-label={t('extensions.kindFilterAria')} data-testid="extensions-kind-chips">
      {shown.map((kind) => {
        const active = selected.includes(kind)
        return (
          <Button
            key={kind}
            size="small"
            variant={active ? 'primary' : 'default'}
            aria-pressed={active}
            onClick={() => toggle(kind)}
            data-testid={`extensions-kind-${kind}`}
          >
            {t(kindLabelKey(kind) as string)}
          </Button>
        )
      })}
    </div>
  )
}
