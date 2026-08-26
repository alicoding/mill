import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBar, Button, Checkbox, Dialog, FormControl, Select, Text } from '@primer/react'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { ScanCategory } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import type { FolderScanEntry, FolderScanResult } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { folderScanEntryDepth, groupFolderScanEntries, type FolderScanGroup } from './atlasFolderScanGrouping'
import { useAtlasFolderImportRequestStore } from './atlasFolderImportRequest'
import { useUISignalStore } from '../shared/uiSignalStore'
import {
  AtlasKindProposal,
  CREATE_KIND_OPTION,
  buildProposalFields,
  initialProposalState,
  proposalNameTaken,
  type KindProposalState,
} from './AtlasKindProposal'
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
  // One in-progress "create a new type" proposal per category (goal
  // 0172 S2) -- absent for a category still pointed at an existing
  // Kind, keyed the same as categoryKindIDs.
  const [proposals, setProposals] = useState<Record<string, KindProposalState>>({})
  const [targetParentID, setTargetParentID] = useState(viewedID)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const groups = scan ? groupFolderScanEntries(scan.Entries ?? []) : []

  const closePreview = () => {
    setScan(null)
    setAccepted(new Set())
    setCategoryKindIDs({})
    setProposals({})
    setError('')
  }

  // pickKind handles the Kind Select's own onChange for one category:
  // switching TO the create option (re-)derives a fresh proposal from
  // that category's own inferred fields; switching to any real Kind
  // discards whatever proposal existed -- the design contract's own
  // "no confirmation, nothing has been created yet" rule.
  const pickKind = (category: string, kindID: string) => {
    setCategoryKindIDs((prev) => ({ ...prev, [category]: kindID }))
    if (kindID === CREATE_KIND_OPTION) {
      const inferred = scan?.CategoryFields?.find((cf) => cf.Category === category)?.Fields ?? []
      setProposals((prev) => ({ ...prev, [category]: initialProposalState(scan?.Root ?? '', inferred) }))
    } else {
      setProposals((prev) => {
        if (!(category in prev)) return prev
        const next = { ...prev }
        delete next[category]
        return next
      })
    }
  }

  const activeProposals = Object.entries(categoryKindIDs)
    .filter(([, kindID]) => kindID === CREATE_KIND_OPTION)
    .map(([category]) => proposals[category])
    .filter((p): p is KindProposalState => p !== undefined)
  const anyProposalNameTaken = activeProposals.some((p) => proposalNameTaken(p.name, kinds))

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

  // confirm creates every pending proposal's own Kind FIRST, then runs
  // ImportFolderSuggestions with each such category repointed at the
  // Kind it just made -- a creation failure throws before the import
  // call is ever reached, so the dialog stays open showing the error
  // and no cards exist yet (this function's own single try/catch, no
  // partial commit possible).
  const confirm = async () => {
    if (!scan) return
    setBusy(true)
    setError('')
    try {
      const resolvedKindIDs = { ...categoryKindIDs }
      for (const [category, kindID] of Object.entries(categoryKindIDs)) {
        if (kindID !== CREATE_KIND_OPTION) continue
        const proposal = proposals[category]
        if (!proposal) continue
        const created = await AtlasService.CreateKind(proposal.name, '', '', buildProposalFields(proposal))
        resolvedKindIDs[category] = created.ID
      }
      await AtlasService.ImportFolderSuggestions({
        Root: scan.Root,
        TargetParentID: targetParentID,
        AcceptedRelPaths: [...accepted],
        CategoryKindIDs: resolvedKindIDs,
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
      {/* Renders as ActionBar.Button (goal 0216), a direct child of
          AtlasToolbar's own ActionBar despite living in this separate
          component -- React context (ActionBar's overflow registry)
          resolves through component composition, not literal JSX
          nesting, so this still participates correctly. The Dialog
          below needs no anchor (it's a modal, not anchor-positioned),
          so only the trigger itself needed to move. */}
      <ActionBar.Button
        leadingVisual={FileDirectoryIcon}
        data-testid="atlas-add-from-folder"
        disabled={busy}
        onClick={() => void startPick()}
      >
        {t('folderImport.addButton')}
      </ActionBar.Button>
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
              disabled: busy || accepted.size === 0 || anyProposalNameTaken,
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
                        onChange={(e) => pickKind(group.category, e.target.value)}
                      >
                        <Select.Option value={CREATE_KIND_OPTION}>{t('folderImport.proposal.createOption')}</Select.Option>
                        {kinds.map((k) => (
                          <Select.Option key={k.ID} value={k.ID}>{k.Icon ? `${k.Icon} ${k.Label}` : k.Label}</Select.Option>
                        ))}
                      </Select>
                    </FormControl>
                    <Button size="small" variant="invisible" onClick={() => setGroupAccepted(group, true)}>{t('folderImport.selectAll')}</Button>
                    <Button size="small" variant="invisible" onClick={() => setGroupAccepted(group, false)}>{t('folderImport.selectNone')}</Button>
                  </div>
                  {categoryKindIDs[group.category] === CREATE_KIND_OPTION && proposals[group.category] && (
                    <AtlasKindProposal
                      value={proposals[group.category]}
                      onChange={(next) => setProposals((prev) => ({ ...prev, [group.category]: next }))}
                      nameTaken={proposalNameTaken(proposals[group.category].name, kinds)}
                    />
                  )}
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
