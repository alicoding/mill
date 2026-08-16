import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, FormControl, Select, Text } from '@primer/react'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { ScanCategory } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import type { FolderScanEntry, FolderScanResult } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { folderScanEntryDepth, groupFolderScanEntries, type FolderScanGroup } from './atlasFolderScanGrouping'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasFolderImport.module.css'

// Synced-folder onboarding (docs/goals/0067): the Atlas toolbar's own
// consent-gated "Add from folder..." action. Nothing reads the
// filesystem until PickFolder returns a path the user explicitly
// chose (DetectSyncRoots only ever pre-fills the dialog's own starting
// location, never scans anything itself); ScanFolder's result is a
// preview only, mirroring the ImportAtlas confirm-bar precedent
// (useAtlasImportConfirm.tsx) -- nothing is written to Atlas until
// ImportFolderSuggestions actually confirms.
export function AtlasFolderImport({ viewedID, kinds }: { viewedID: string; kinds: Kind[] }) {
  const { t } = useTranslation('atlas')
  const [scan, setScan] = useState<FolderScanResult | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [categoryKindIDs, setCategoryKindIDs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const groups = scan ? groupFolderScanEntries(scan.Entries ?? []) : []

  const closePreview = () => {
    setScan(null)
    setAccepted(new Set())
    setCategoryKindIDs({})
    setError('')
  }

  const startPick = async () => {
    setError('')
    setBusy(true)
    try {
      const roots = await AtlasService.DetectSyncRoots()
      const path = await AtlasService.PickFolder(roots?.[0] ?? '')
      if (!path) return // the user canceled the picker -- no error, nothing scanned
      const result = await AtlasService.ScanFolder(path)
      const entries = result.Entries ?? []
      setScan(result)
      setAccepted(new Set(entries.map((e) => e.RelPath)))
      const nextKindIDs: Record<string, string> = {}
      for (const group of groupFolderScanEntries(entries)) {
        nextKindIDs[group.category] = kinds[0]?.ID ?? ''
      }
      setCategoryKindIDs(nextKindIDs)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleEntry = (relPath: string, checked: boolean) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (checked) next.add(relPath)
      else next.delete(relPath)
      return next
    })
  }

  const setGroupAccepted = (group: FolderScanGroup, checked: boolean) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      for (const entry of group.entries) {
        if (checked) next.add(entry.RelPath)
        else next.delete(entry.RelPath)
      }
      return next
    })
  }

  const confirm = async () => {
    if (!scan) return
    setBusy(true)
    setError('')
    try {
      await AtlasService.ImportFolderSuggestions({
        Root: scan.Root,
        TargetParentID: viewedID,
        AcceptedRelPaths: [...accepted],
        CategoryKindIDs: categoryKindIDs,
      })
      closePreview()
      await refreshAtlas()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const categoryLabel = (category: ScanCategory) => {
    if (category === ScanCategory.ScanCategoryContainer) return t('folderImport.categoryContainer')
    if (category === ScanCategory.ScanCategoryImage) return t('folderImport.categoryImage')
    return t('folderImport.categoryFile')
  }

  return (
    <>
      <Button
        leadingVisual={FileDirectoryIcon}
        size="small"
        variant="invisible"
        data-testid="atlas-add-from-folder"
        disabled={busy}
        onClick={() => void startPick()}
      >
        {t('folderImport.addButton')}
      </Button>
      {scan && (
        // data-component, not data-testid: Primer's Dialog only forwards
        // its own special-cased "data-component" prop (AtlasCardOverlay.tsx's
        // own comment has the full reasoning).
        <Dialog
          title={t('folderImport.title')}
          onClose={closePreview}
          data-component="atlas-folder-import-dialog"
          footerButtons={[
            { content: t('cancel'), onClick: closePreview },
            {
              content: t('folderImport.confirmButton', { count: accepted.size }),
              buttonType: 'primary',
              onClick: () => void confirm(),
              disabled: busy || accepted.size === 0,
            },
          ]}
        >
          {scan.Truncated && (
            <Text as="p" size="small" data-testid="atlas-folder-import-truncated">
              {t('folderImport.truncatedNotice', { count: scan.MaxEntries })}
            </Text>
          )}
          {error && (
            <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-folder-import-error">
              {error}
            </Text>
          )}
          {groups.length === 0 ? (
            <Text as="p" size="small" className={runbookStyles.muted}>{t('folderImport.empty')}</Text>
          ) : (
            <div className={styles.groups}>
              {groups.map((group) => (
                <div key={group.category} className={styles.group} data-testid="atlas-folder-import-group">
                  <div className={styles.groupHeader}>
                    <Text as="span" size="small" weight="semibold">{categoryLabel(group.category)}</Text>
                    <FormControl className={styles.groupKind}>
                      <FormControl.Label visuallyHidden>{t('folderImport.kindLabel')}</FormControl.Label>
                      <Select
                        size="small"
                        value={categoryKindIDs[group.category] ?? ''}
                        data-testid="atlas-folder-import-kind"
                        onChange={(e) => setCategoryKindIDs((prev) => ({ ...prev, [group.category]: e.target.value }))}
                      >
                        {kinds.map((k) => (
                          <Select.Option key={k.ID} value={k.ID}>{k.Icon ? `${k.Icon} ${k.Label}` : k.Label}</Select.Option>
                        ))}
                      </Select>
                    </FormControl>
                    <Button size="small" variant="invisible" onClick={() => setGroupAccepted(group, true)}>{t('folderImport.selectAll')}</Button>
                    <Button size="small" variant="invisible" onClick={() => setGroupAccepted(group, false)}>{t('folderImport.selectNone')}</Button>
                  </div>
                  {group.entries.map((entry: FolderScanEntry) => (
                    <FormControl key={entry.RelPath} style={{ paddingLeft: folderScanEntryDepth(entry.RelPath) * 16 }}>
                      <Checkbox
                        value={entry.RelPath}
                        checked={accepted.has(entry.RelPath)}
                        data-testid="atlas-folder-import-entry"
                        onChange={(e) => toggleEntry(entry.RelPath, e.target.checked)}
                      />
                      <FormControl.Label>{entry.SuggestedTitle || entry.Name}</FormControl.Label>
                    </FormControl>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}
