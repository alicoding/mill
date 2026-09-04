import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TreeView } from '@primer/react'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { OutputHighlight } from './OutputHighlight'
import { writeClipboardText } from './clipboardWrite'
import {
  ROOT_PATH,
  allContainerPaths,
  childrenOf,
  containerSummary,
  nodeCopyText,
  pathsToExpandFor,
  primitiveLabel,
  type JsonNode,
} from './jsonTreeModel'
import styles from './OutputViewer.module.css'

// The Tree view (goal 0326): containers as nodes, primitives as rows,
// a collapsed container showing its count. Primer's own TreeView is
// the tree here -- the kit already ships the roving tabindex, the
// arrow-key navigation and the aria-expanded semantics a hand-rolled
// tree would have to reinvent (composition/NodePalette.tsx is the
// other consumer).
//
// Expansion is CONTROLLED, not per-item local state: Expand all,
// Collapse all and a find hit inside a collapsed container all move
// the same set, which a tree of uncontrolled items could not express.

export interface JsonTreeProps {
  value: unknown
  // The find query, highlighted in every row and opening any container
  // that hides a hit.
  query?: string
  // Set by the viewer's Expand all / Collapse all. A bump forces the
  // expansion set to that state; between bumps the reader's own clicks
  // own it.
  expandAllToken?: number
  collapseAllToken?: number
  ariaLabel: string
  testId?: string
}

export function JsonTree({ value, query = '', expandAllToken = 0, collapseAllToken = 0, ariaLabel, testId }: JsonTreeProps) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(topLevelContainers(value)))
  const [bulk, setBulk] = useState({ expand: 0, collapse: 0 })
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // A bulk request is applied while rendering rather than from an
  // effect: the tree must never paint one frame in the old state.
  if (expandAllToken !== bulk.expand) {
    setBulk({ expand: expandAllToken, collapse: collapseAllToken })
    setExpanded(new Set(allContainerPaths(value)))
  } else if (collapseAllToken !== bulk.collapse) {
    setBulk({ expand: expandAllToken, collapse: collapseAllToken })
    setExpanded(new Set())
  }

  const forced = useMemo(() => pathsToExpandFor(value, query), [value, query])
  const roots = useMemo(() => childrenOf(value, ROOT_PATH), [value])

  const openMenu = (event: React.MouseEvent, node: JsonNode) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: 'copy', label: t('output.copy'), run: () => { void writeClipboardText(nodeCopyText(node)) } },
        { id: 'copy-path', label: t('output.copyPath'), run: () => { void writeClipboardText(node.path) } },
      ],
    })
  }

  const toggle = (path: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const renderNodes = (nodes: JsonNode[]): React.ReactNode =>
    nodes.map((node) => {
      const open = expanded.has(node.path) || forced.has(node.path)
      if (node.kind === 'primitive') {
        return (
          <TreeView.Item
            key={node.path}
            id={node.path}
            onSelect={() => { /* A leaf has nothing to open; selection is the row's own affordance. */ }}
            onContextMenu={(event: React.MouseEvent) => openMenu(event, node)}
            data-testid="json-tree-leaf"
            data-path={node.path}
          >
            <span className={styles.treeRow}>
              <span className={styles.treeKey}><OutputHighlight text={node.key} query={query} /></span>
              <span className={styles.treeValue}><OutputHighlight text={primitiveLabel(node.value)} query={query} /></span>
            </span>
          </TreeView.Item>
        )
      }
      return (
        <TreeView.Item
          key={node.path}
          id={node.path}
          expanded={open}
          onExpandedChange={(next) => toggle(node.path, next)}
          onContextMenu={(event: React.MouseEvent) => openMenu(event, node)}
          data-testid="json-tree-node"
          data-path={node.path}
        >
          <span className={styles.treeRow}>
            <span className={styles.treeKey}><OutputHighlight text={node.key} query={query} /></span>
            <span className={styles.treeCount}>{containerSummary(node)}</span>
          </span>
          <TreeView.SubTree>{renderNodes(childrenOf(node.value, node.path))}</TreeView.SubTree>
        </TreeView.Item>
      )
    })

  return (
    <div className={styles.tree} data-testid={testId}>
      <TreeView aria-label={ariaLabel}>{renderNodes(roots)}</TreeView>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

// A tree that opens fully collapsed hides everything the reader came
// for; one level open is what an inspector shows on arrival.
function topLevelContainers(value: unknown): string[] {
  return childrenOf(value, ROOT_PATH).filter((n) => n.kind !== 'primitive').map((n) => n.path)
}
