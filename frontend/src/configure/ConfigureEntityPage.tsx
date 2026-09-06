import type { ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Heading, Stack, VisuallyHidden } from '@primer/react'
import { PlusIcon, UploadIcon } from '@primer/octicons-react'
import { RestoreExamplesButton, type RestorableItem } from '../shared/RestoreExamplesButton'
import { ViewModeToggle } from '../shared/ViewModeToggle'
import type { ViewMode } from '../shared/viewMode'
import styles from '../shared/ListCard.module.css'
import { PaneLoading } from './PaneLoading'
import PageContainer from '../shared/PageContainer'

export interface ConfigureEntityPageProps {
  pageTestId: string
  headingId: string
  headingText: string

  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void

  // Import/export is per entity kind; a kind that names a file on this
  // machine (a secret source) has nothing portable to import, and
  // omits these.
  importInputRef?: RefObject<HTMLInputElement | null>
  importInputTestId?: string
  importTestId?: string
  onImportFile?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onImportClick?: () => void
  importErrorNode?: ReactNode

  restorable?: RestorableItem[]
  onRestore?: (id: string) => void

  // Extra header controls a specific page needs beyond the shared
  // import/restore/primary trio (e.g. ConfigureLists' "New list from
  // file"), rendered between RestoreExamplesButton and the primary
  // create button.
  extraHeaderActions?: ReactNode

  primaryLabel: string
  primaryTestId: string
  onPrimary: () => void

  formOpen: boolean
  formContent?: ReactNode

  loading: boolean
  showTable: boolean
  tableContent?: ReactNode
  showRows: boolean
  rowsContent?: ReactNode

  confirmDialog?: ReactNode
  importConfirmDialog?: ReactNode

  // Content a page renders after everything else but still inside the
  // page's own PageContainer (e.g. ConfigureMCPServers' per-server
  // "List tools" result panels) -- kept as an explicit slot rather than
  // a caller-side Fragment wrapper so it stays inside the same width
  // constraint as the rest of the page.
  trailingContent?: ReactNode
}

// The chrome every Configure entity inventory page shares (docs/goals/
// 0167): the header row (view-mode toggle, import picker, restore-
// examples menu, primary create action), the import-error slot, the
// create/edit form's panel wrapper, and the loading/table/rows
// switch plus its two confirm dialogs. A page supplies its own field
// content, table columns, and row items -- the parts that actually
// vary per entity -- everything else renders here once.
export function ConfigureEntityPage({
  pageTestId, headingId, headingText,
  viewMode, onViewModeChange,
  importInputRef, importInputTestId, importTestId, onImportFile, onImportClick, importErrorNode,
  restorable, onRestore,
  extraHeaderActions,
  primaryLabel, primaryTestId, onPrimary,
  formOpen, formContent,
  loading, showTable, tableContent, showRows, rowsContent,
  confirmDialog, importConfirmDialog, trailingContent,
}: ConfigureEntityPageProps) {
  const { t } = useTranslation('configure')

  return (
    <PageContainer data-testid={pageTestId}>
      <Stack direction="horizontal" justify="end" align="center" className={styles.sectionHeading}>
        {/* Design-wave-1 fix #6: the Configure tab already names this
            section -- visually hidden (not removed) so the aria-labelledby
            wiring below and the a11y heading structure both stay intact. */}
        <VisuallyHidden>
          <Heading as="h2" variant="small" id={headingId}>{headingText}</Heading>
        </VisuallyHidden>
        <Stack direction="horizontal" gap="condensed">
          <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
          {onImportClick && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                data-testid={importInputTestId}
                style={{ display: 'none' }}
                onChange={onImportFile}
              />
              <Button leadingVisual={UploadIcon} size="small" onClick={onImportClick} data-testid={importTestId}>
                {t('import')}
              </Button>
            </>
          )}
          {onRestore && <RestoreExamplesButton items={restorable ?? []} onRestore={onRestore} />}
          {extraHeaderActions}
          <Button leadingVisual={PlusIcon} variant="primary" size="small" onClick={onPrimary} data-testid={primaryTestId}>
            {primaryLabel}
          </Button>
        </Stack>
      </Stack>
      {importErrorNode}

      {formOpen && (
        <PageContainer variant="narrow">
          <div className={styles.card}>
            {formContent}
          </div>
        </PageContainer>
      )}

      {loading && <PaneLoading />}
      {showTable && tableContent}
      {showRows && rowsContent}
      {confirmDialog}
      {importConfirmDialog}
      {trailingContent}
    </PageContainer>
  )
}
