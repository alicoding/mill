import { useTranslation } from 'react-i18next'
import { IconButton, SegmentedControl, Stack, TextInput } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, DownloadIcon, ScreenFullIcon, SearchIcon, WrapIcon } from '@primer/octicons-react'
import { VIEW_LABEL_KEY, type OutputView } from './outputShape'
import styles from './OutputViewer.module.css'

// One toolbar for every shape (goal 0326). The controls a view cannot
// honour are ABSENT, never dimmed: Wrap belongs to the text views,
// Expand all to the tree, Save to the binary branch. The switch's
// selected item is the view in front of the reader; when the shape was
// inferred rather than declared, its tooltip says so, so an automatic
// choice is always visible and always overridable.

export interface OutputToolbarProps {
  views: OutputView[]
  view: OutputView
  onViewChange: (view: OutputView) => void
  detectedView: OutputView | null
  findOpen: boolean
  query: string
  onQueryChange: (query: string) => void
  onCloseFind: () => void
  wrap: boolean
  showWrap: boolean
  showFind: boolean
  showExpand: boolean
  showSave: boolean
  showOpenFull: boolean
  onExpandAll: () => void
  onCollapseAll: () => void
  onSave: () => void
  // Every action is a registry command; the viewer publishes itself as
  // the focused target first, so a command acting on "the focused
  // viewer" acts on this one.
  invoke: (commandId: string) => void
}

export function OutputViewerToolbar(props: OutputToolbarProps) {
  const { t } = useTranslation('common')
  const selectedIndex = Math.max(0, props.views.indexOf(props.view))

  return (
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap" className={styles.toolbar} data-testid="output-toolbar">
      {props.views.length > 1 && (
        <SegmentedControl aria-label={t('output.viewAriaLabel')} size="small" onChange={(index) => props.onViewChange(props.views[index])}>
          {props.views.map((view, index) => {
            const label = t(VIEW_LABEL_KEY[view])
            // The detected item names itself as detected, through the
            // button's own title/aria-description rather than a Tooltip
            // wrapper: SegmentedControl injects each item's selection
            // and click handling by cloning its DIRECT children, so a
            // wrapper element silently swallows both.
            const detected = view === props.detectedView ? t('output.detectedAs', { view: label }) : undefined
            return (
              <SegmentedControl.Button
                key={view}
                selected={index === selectedIndex}
                title={detected}
                aria-description={detected}
                data-testid={`output-view-${view}`}
              >
                {label}
              </SegmentedControl.Button>
            )
          })}
        </SegmentedControl>
      )}

      {props.showExpand && (
        <>
          <IconButton icon={ChevronDownIcon} aria-label={t('output.expandAll')} size="small" variant="invisible" onClick={props.onExpandAll} data-testid="output-expand-all" />
          <IconButton icon={ChevronRightIcon} aria-label={t('output.collapseAll')} size="small" variant="invisible" onClick={props.onCollapseAll} data-testid="output-collapse-all" />
        </>
      )}

      {props.showWrap && (
        <IconButton
          icon={WrapIcon}
          aria-label={t('output.wrap')}
          aria-pressed={props.wrap}
          size="small"
          variant={props.wrap ? 'default' : 'invisible'}
          onClick={() => props.invoke('output.toggleWrap')}
          data-testid="output-wrap"
        />
      )}

      {props.showFind && (
        <IconButton icon={SearchIcon} aria-label={t('output.find')} size="small" variant="invisible" onClick={() => props.invoke('output.find')} data-testid="output-find" />
      )}

      <IconButton icon={CopyIcon} aria-label={t('output.copy')} size="small" variant="invisible" onClick={() => props.invoke('output.copy')} data-testid="output-copy" />

      {props.showSave && (
        <IconButton icon={DownloadIcon} aria-label={t('output.save')} size="small" variant="invisible" onClick={props.onSave} data-testid="output-save" />
      )}

      {props.showOpenFull && (
        <IconButton icon={ScreenFullIcon} aria-label={t('output.openFull')} size="small" variant="invisible" onClick={() => props.invoke('output.openFull')} data-testid="output-open-full" />
      )}

      {props.findOpen && (
        <TextInput
          className={styles.findField}
          size="small"
          value={props.query}
          aria-label={t('output.find')}
          placeholder={t('output.find')}
          autoFocus
          onChange={(e) => props.onQueryChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); props.onCloseFind() } }}
          data-testid="output-find-field"
        />
      )}
    </Stack>
  )
}
