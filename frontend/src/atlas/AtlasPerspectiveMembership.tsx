import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionMenu, ActionList, Text, Token } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'
import { useAtlasStore, refreshAtlasPerspectives } from './atlasStore'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasPerspectiveMembership.module.css'

// The card page's own compact membership row (ADR-0041, goal 0095
// slice 2): self-contained by design -- takes only cardID, reads
// perspectives from the shared atlas store itself, and owns its own
// add/remove calls -- so mounting it is the one-line insertion
// AtlasCardOverlay.tsx carries (goal 0106 slice B is reworking that
// page's own layout concurrently; this file is the entire footprint
// beyond that single line). Renders nothing when no perspective exists
// yet -- an empty affordance for a capability the space hasn't adopted
// would just be page noise (0106's own "empty fields are one-line
// invitations, not boxes" spirit, applied here without waiting on that
// goal's own build).
export function AtlasPerspectiveMembership({ cardID }: { cardID: string }) {
  const { t } = useTranslation('atlas')
  const perspectives = useAtlasStore((s) => s.perspectives) ?? []
  const [open, setOpen] = useState(false)

  if (perspectives.length === 0) return null

  const member = perspectives.filter((p) => (p.MemberCardIDs ?? []).includes(cardID))
  const addable = perspectives.filter((p) => !(p.MemberCardIDs ?? []).includes(cardID))

  const add = (perspectiveID: string) => {
    setOpen(false)
    void AtlasService.AddToPerspective(perspectiveID, cardID).then(() => refreshAtlasPerspectives())
  }
  const remove = (perspectiveID: string) => {
    void AtlasService.RemoveFromPerspective(perspectiveID, cardID).then(() => refreshAtlasPerspectives())
  }

  return (
    <div className={styles.row} data-testid="atlas-page-perspective-membership">
      <Text size="small" className={runbookStyles.muted}>{t('perspective.membershipLabel')}</Text>
      {member.map((p) => (
        <Token key={p.ID} text={p.Name} size="large" data-testid={`atlas-page-perspective-chip-${p.ID}`} onRemove={() => remove(p.ID)} />
      ))}
      {addable.length > 0 && (
        <ActionMenu open={open} onOpenChange={setOpen}>
          <ActionMenu.Button leadingVisual={PlusIcon} size="small" variant="invisible" data-testid="atlas-page-perspective-add">
            {t('perspective.addChip')}
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList>
              {addable.map((p) => (
                <ActionList.Item key={p.ID} onSelect={() => add(p.ID)} data-testid={`atlas-page-perspective-add-${p.ID}`}>
                  {p.Name}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      )}
    </div>
  )
}
