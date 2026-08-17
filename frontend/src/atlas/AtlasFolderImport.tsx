import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, FormControl, Select, Text } from '@primer/react'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { ScanCategory } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import type { FolderScanEntry, FolderScanResult } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { folderScanEntryDepth, groupFolderScanEntries, type FolderScanGroup } from './atlasFolderScanGrouping'
import { useAtlasFolderImportRequestStore } from './atlasFolderImportRequest'
import { useUISignalStore } from '../shared/uiSignalStore'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasFolderImport.module.css'

// Synced-folder onboarding (docs/goals/0067): the Atlas toolbar's own
// consent-gated "Add from folder..." action. Nothing reads the
// filesystem until PickFolder returns a path the user explicitly
// chose (DetectSyncRoots only ever pre-fills the dialog's own starting
// location, never scans anything itself); ScanFolder's result is a
// preview only, mirroring the ImportAtlas confirm-bar precedent
// (useAtlasImportConfirm.tsx) -- nothing is written to Atlas until
// ImportFolderSuggestions actually confirms. Also the landing spot for
// a multi-file/directory native OS drop's own prescoped preview (goal
// 0081 slice A3, LOCKED design §3b) -- atlasFolderImportRequest.ts's
// store lets AtlasBoard/AtlasCardOverlay request a scan here without
// going through PickFolder, with the drop's own parent as the target
// instead of always the currently viewed space.
export function AtlasFolderImport({ viewedID, kinds }: { viewedID: string; kinds: Kind[] }) {
  const { t } = useTranslation('atlas')
  const [scan, setScan] = useState<FolderScanResult | null>(null)
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [categoryKindIDs, setCategoryKindIDs] = useState<Record<string, string>>({})
  const [targetParentID, setTargetParentID] = useState(viewedID)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const groups = scan ? groupFolderScanEntries(scan.Entries ?? []) : []

  const closePreview = () => {
    setScan(null)
    setAccepted(new Set())
    setCategoryKindIDs({})
    setError('')
  }

  const scanRoot = async (root: string, parentID: string) => {
    setTargetParentID(parentID)
    setError('')
    setBusy(true)
    try {
      const result = await AtlasService.ScanFolder(root)
      const entries = result.Entries ?? []
      setScan(result)
      // A row flagged as already-on-the-map (goal 0088) starts
      // unchecked -- importing it anyway is an explicit opt-in, not
      // the default.
      setAccepted(new Set(entries.filter((e) => !e.DuplicateOfCardID).map((e) => e.RelPath)))
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

  const startPick = async () => {
    setError('')
    setBusy(true)
    try {
      const roots = await AtlasService.DetectSyncRoots()
      const path = await AtlasService.PickFolder(roots?.[0] ?? '')
      if (!path) { setBusy(false); return } // the user canceled the picker -- no error, nothing scanned
      await scanRoot(path, viewedID)
    } catch (err) {
      setError(String(err))
      setBusy(false)
    }
  }

  // The prescoped-import request (goal 0081 slice A3): a fresh token
  // opens the SAME preview against the drop's own root/parent, bypassing
  // PickFolder entirely -- same token-diffing shape useAtlasCreation.ts's
  // one-shot signals already use.
  const folderImportRequest = useAtlasFolderImportRequestStore((s) => s.request)
  const lastRequestToken = useRef(folderImportRequest?.token)
  useEffect(() => {
    if (!folderImportRequest || folderImportRequest.token === lastRequestToken.current) return
    lastRequestToken.current = folderImportRequest.token
    void scanRoot(folderImportRequest.root, folderImportRequest.parentID)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token, scanRoot reads current kinds/viewedID via closure at fire time same as every other request-token effect in atlas/
  }, [folderImportRequest])

  // atlas.addFromFolder's own signal (shared/atlasBoardCommands.ts): a
  // palette/keyboard invocation runs the SAME PickFolder flow the
  // toolbar's own "Add cards from a folder" button does.
  const addFromFolderRequest = useUISignalStore((s) => s.atlasAddFromFolderRequest)
  const lastAddFromFolderRequest = useRef(addFromFolderRequest)
  useEffect(() => {
    if (addFromFolderRequest === lastAddFromFolderRequest.current) return
    lastAddFromFolderRequest.current = addFromFolderRequest
    void startPick()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone, startPick reads current viewedID via closure at fire time same as every other request-token effect in atlas/
  }, [addFromFolderRequest])

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
        TargetParentID: targetParentID,
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
                      {entry.DuplicateOfCardID && (
                        // FormControl.Caption destructures its own prop
                        // list with no rest-spread, so a plain
                        // data-testid on it is silently dropped
                        // (AtlasCardOverlay.tsx's Dialog comment
                        // documents the same Primer constraint) -- an
                        // inner span carries the testid instead.
                        <FormControl.Caption>
                          <span data-testid="atlas-folder-import-duplicate">
                            {t('folderImport.duplicateOf', { title: entry.DuplicateOfTitle })}
                          </span>
                        </FormControl.Caption>
                      )}
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
