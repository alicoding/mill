import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Dialog, Stack, Text } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import type { Kind, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { AtlasKindEditor, AtlasLinkKindEditor } from './AtlasKindEditor'
import runbookStyles from '../shared/ListCard.module.css'

type Pane =
  | { view: 'list' }
  | { view: 'kind'; kind: Kind | null }
  | { view: 'linkkind'; linkKind: LinkKind | null }

// The Kinds dialog (goal 0079): the one place card kinds and link
// kinds are created, edited, and deleted in-app -- until now seeds and
// import were the only doors into this vocabulary. List view shows
// both families; picking a row (or a "+ New ..." button) swaps to the
// matching editor pane; saving or canceling returns to the list. Data
// refreshes ride the store's own mill-data-changed subscription, so
// this dialog only signals intent and never re-fetches itself.
export function AtlasKindManager({ open, onClose, kinds, linkKinds }: {
  open: boolean
  onClose: () => void
  kinds: Kind[]
  linkKinds: LinkKind[]
}) {
  const { t } = useTranslation('atlas')
  const [pane, setPane] = useState<Pane>({ view: 'list' })
  const [pendingDelete, setPendingDelete] = useState<{ family: 'kind' | 'linkkind'; id: string; label: string } | null>(null)
  const [error, setError] = useState('')

  if (!open) return null

  const backToList = () => { setPane({ view: 'list' }); setError('') }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const op = pendingDelete.family === 'kind'
      ? AtlasService.DeleteKind(pendingDelete.id)
      : AtlasService.DeleteLinkKind(pendingDelete.id)
    op.then(() => setError('')).catch((err) => setError(String(err)))
    setPendingDelete(null)
  }

  return (
    <Dialog title={t('kinds.dialogTitle')} onClose={onClose} width="large" data-component="atlas-kind-manager">
      {pane.view === 'list' && (
        <Stack gap="normal" data-testid="atlas-kind-manager-list">
          <Text weight="semibold" size="small">{t('kinds.cardKindsHeading')}</Text>
          {kinds.length === 0 ? (
            <Text size="small" className={runbookStyles.muted}>{t('kinds.cardKindsEmpty')}</Text>
          ) : (
            <ActionList>
              {kinds.map((k) => (
                <ActionList.Item key={k.ID} data-testid="atlas-kind-row" onSelect={() => setPane({ view: 'kind', kind: k })}>
                  {k.Icon} {k.Label}
                  <ActionList.Description>
                    {t('kinds.fieldCount', { count: k.Fields?.length ?? 0 })}
                  </ActionList.Description>
                  <ActionList.TrailingAction
                    icon={TrashIcon}
                    label={t('kinds.deleteAriaLabel', { label: k.Label })}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPendingDelete({ family: 'kind', id: k.ID, label: k.Label }) }}
                  />
                </ActionList.Item>
              ))}
            </ActionList>
          )}
          <div>
            <Button size="small" variant="invisible" onClick={() => setPane({ view: 'kind', kind: null })} data-testid="atlas-kind-new">
              {t('kinds.newCardKind')}
            </Button>
          </div>

          <Text weight="semibold" size="small">{t('kinds.linkKindsHeading')}</Text>
          {linkKinds.length === 0 ? (
            <Text size="small" className={runbookStyles.muted}>{t('kinds.linkKindsEmpty')}</Text>
          ) : (
            <ActionList>
              {linkKinds.map((lk) => (
                <ActionList.Item key={lk.ID} data-testid="atlas-linkkind-row" onSelect={() => setPane({ view: 'linkkind', linkKind: lk })}>
                  {lk.Label}
                  <ActionList.TrailingAction
                    icon={TrashIcon}
                    label={t('kinds.deleteAriaLabel', { label: lk.Label })}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setPendingDelete({ family: 'linkkind', id: lk.ID, label: lk.Label }) }}
                  />
                </ActionList.Item>
              ))}
            </ActionList>
          )}
          <div>
            <Button size="small" variant="invisible" onClick={() => setPane({ view: 'linkkind', linkKind: null })} data-testid="atlas-linkkind-new">
              {t('kinds.newLinkKind')}
            </Button>
          </div>

          {error && <Text size="small" className={runbookStyles.error} data-testid="atlas-kind-manager-error">{error}</Text>}
        </Stack>
      )}

      {pane.view === 'kind' && (
        <AtlasKindEditor kind={pane.kind} kinds={kinds} onSaved={backToList} onCancel={backToList} />
      )}
      {pane.view === 'linkkind' && (
        <AtlasLinkKindEditor linkKind={pane.linkKind} onSaved={backToList} onCancel={backToList} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('kinds.deleteTitle', { label: pendingDelete.label })}
          body={pendingDelete.family === 'kind' ? t('kinds.deleteKindBody') : t('kinds.deleteLinkKindBody')}
          confirmLabel={t('kinds.deleteConfirm')}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Dialog>
  )
}
