import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TreeView } from '@primer/react'
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from './ContextMenu'
import { OutputHighlight } from './OutputHighlight'
import {
  ROOT_PATH,
  allContainerPaths,
  childrenOf,
  containerSummary,
  nodeCopyText,
  nodesByPath,
  pathsToDepth,
  pathsToExpandFor,
  nodeMatches,
  primitiveLabel,
  subtreeMatches,
  valueKind,
  type JsonNode,
} from './jsonTreeModel'
import styles from './OutputViewer.module.css'

// Type by rendering, never by a badge (goal 0269 rule 7) -- the
// convention every browser object inspector converged on. A container's
// own row carries no value, so only the four primitive kinds appear.
const VALUE_CLASS: Partial<Record<ReturnType<typeof valueKind>, string>> = {
  string: styles.treeValueString,
  number: styles.treeValueNumber,
  boolean: styles.treeValueLiteral,
  null: styles.treeValueLiteral,
}

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
//
// The board's json face (goal 0269) is the second consumer: everything
// it needed beyond the viewer's own use arrives as a prop below, so
// there is exactly ONE JSON tree in the app rather than one per
// surface.

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
  // The token every row's path is built from. '$' (the default) is the
  // rooted form the Output viewer shows; '' is the root-less form the
  // browser inspectors' own "Copy property path" produces
  // (`workstreams[0].owner`), which the board's json face uses.
  rootPath?: string
  // How many container levels are open on arrival: 1 shows the root's
  // own members, 2 also opens theirs. Read once, at mount -- after that
  // the reader (and Expand all / Collapse all) own the set, so a
  // re-parse of the same file keeps open whatever was open.
  defaultExpandDepth?: number
  // The row's own right-click menu. Omitted, a row offers the viewer's
  // two plain copies; a surface with registry commands for the job
  // supplies them here instead, so this component never learns any one
  // surface's command ids.
  rowMenuItems?: (node: JsonNode) => ContextMenuItem[]
  // Which row currently holds focus, so a surface offering a keystroke
  // that acts on "the focused row" has a row to act on. Null once focus
  // leaves the tree entirely.
  onFocusedRowChange?: (node: JsonNode | null) => void
  // Where a row's context menu should actually open (goal 0346). Unset,
  // the tree renders its own menu in place -- correct for a mount with
  // no transformed ancestor (the Output viewer's use, position:fixed
  // resolving against the viewport as usual). A host whose own DOM sits
  // inside a scaled/translated ancestor (a React Flow node) supplies
  // this instead: the tree hands it the row's menu and pointer/keyboard
  // position rather than rendering one of its own, so the host can open
  // it through a renderer mounted outside that transform.
  onOpenContextMenu?: (state: ContextMenuState) => void
  // What a query DOES to the rows. The viewer FINDS: every row stays,
  // hits are highlighted, and whatever hid one opens. A filter HIDES:
  // only a matching row, its ancestors and its own subtree remain -- the
  // narrowing a board-sized box needs, where scrolling past the misses
  // is not an option.
  filterRows?: boolean
}

export function JsonTree({
  value,
  query = '',
  expandAllToken = 0,
  collapseAllToken = 0,
  ariaLabel,
  testId,
  rootPath = ROOT_PATH,
  defaultExpandDepth = 1,
  rowMenuItems,
  onFocusedRowChange,
  onOpenContextMenu,
  filterRows = false,
}: JsonTreeProps) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(pathsToDepth(value, defaultExpandDepth, rootPath)))
  const [bulk, setBulk] = useState({ expand: 0, collapse: 0 })
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  // A bulk request is applied while rendering rather than from an
  // effect: the tree must never paint one frame in the old state.
  if (expandAllToken !== bulk.expand) {
    setBulk({ expand: expandAllToken, collapse: collapseAllToken })
    setExpanded(new Set(allContainerPaths(value, rootPath)))
  } else if (collapseAllToken !== bulk.collapse) {
    setBulk({ expand: expandAllToken, collapse: collapseAllToken })
    setExpanded(new Set())
  }

  const forced = useMemo(() => pathsToExpandFor(value, query, rootPath), [value, query, rootPath])
  const roots = useMemo(() => childrenOf(value, rootPath), [value, rootPath])
  const byPath = useMemo(() => nodesByPath(value, rootPath), [value, rootPath])

  // The same two row commands the Atlas JSON object's face runs (goal
  // 0269), over this row as the jsonNode context.
  const defaultMenuItems = (node: JsonNode): ContextMenuItem[] => {
    const ctx = { kind: 'jsonNode' as const, path: node.path, key: node.key, value: nodeCopyText(node) }
    return [
      { id: 'copy', label: t('output.copy'), commandId: 'atlas.json.copyValue', ctx },
      { id: 'copy-path', label: t('output.copyPath'), commandId: 'atlas.json.copyPath', ctx },
    ]
  }

  // The one place a row's menu actually opens from: onOpenContextMenu
  // wins when the host supplied one (see the prop's own doc above),
  // else the tree renders its own -- callers never see which branch
  // ran.
  const openMenuAt = (x: number, y: number, node: JsonNode) => {
    const state = { x, y, items: (rowMenuItems ?? defaultMenuItems)(node) }
    if (onOpenContextMenu) onOpenContextMenu(state)
    else setMenu(state)
  }

  const openMenu = (event: React.MouseEvent, node: JsonNode) => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(event.clientX, event.clientY, node)
  }

  // The context-menu key / Shift+F10 (the OS/browser convention for
  // "open this element's menu without a mouse"): opens at the focused
  // row's own bounding box rather than the pointer, since there is no
  // pointer position to use.
  const openMenuFromKeyboard = (event: React.KeyboardEvent) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    const node = rowFrom(event.target)
    const el = event.target instanceof HTMLElement ? event.target.closest('[data-path]') : null
    if (!node || !el) return
    event.preventDefault()
    const rect = el.getBoundingClientRect()
    openMenuAt(rect.left, rect.bottom, node)
  }

  const toggle = (path: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }

  // TreeView.Item installs its own onFocus AFTER spreading restProps
  // and stops the synthetic event there, so a row gaining focus is only
  // observable from the CAPTURE phase on this container.
  const rowFrom = (target: EventTarget | null): JsonNode | null => {
    const el = target instanceof HTMLElement ? target.closest('[data-path]') : null
    const path = el?.getAttribute('data-path')
    return path ? byPath.get(path) ?? null : null
  }

  const filtering = filterRows && query !== ''
  // A row survives the filter when it matches, when something under it
  // matches, or when an ANCESTOR matched -- a hit brings its whole
  // subtree with it, so the reader sees the matched value in context
  // rather than a bare key.
  const keeps = (node: JsonNode, ancestorMatched: boolean): boolean =>
    ancestorMatched || nodeMatches(node, query) || (node.kind !== 'primitive' && subtreeMatches(node, query))

  const renderNodes = (nodes: JsonNode[], ancestorMatched = false): React.ReactNode =>
    (filtering ? nodes.filter((n) => keeps(n, ancestorMatched)) : nodes).map((node) => {
      const matched = ancestorMatched || (filtering && nodeMatches(node, query))
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
            data-value-kind={valueKind(node.value)}
          >
            <span className={styles.treeRow}>
              <span className={styles.treeKey}><OutputHighlight text={node.key} query={query} /></span>
              <span className={`${styles.treeValue} ${VALUE_CLASS[valueKind(node.value)] ?? ''}`}>
                <OutputHighlight text={primitiveLabel(node.value)} query={query} />
              </span>
            </span>
          </TreeView.Item>
        )
      }
      // An empty container gets NO subtree, so the kit renders no
      // chevron: nothing opens, and the bare `{}` / `[]` says so.
      const children = childrenOf(node.value, node.path)
      return (
        <TreeView.Item
          key={node.path}
          id={node.path}
          expanded={children.length === 0 ? undefined : open}
          onExpandedChange={(next) => toggle(node.path, next)}
          onContextMenu={(event: React.MouseEvent) => openMenu(event, node)}
          data-testid="json-tree-node"
          data-path={node.path}
          data-value-kind={node.kind}
        >
          <span className={styles.treeRow}>
            <span className={styles.treeKey}><OutputHighlight text={node.key} query={query} /></span>
            {/* The count answers "how much is hidden here" -- an open
                container hides nothing, so it drops the count and the
                row reads as the key alone. */}
            {!open && <span className={styles.treeCount}>{containerSummary(node)}</span>}
          </span>
          {children.length > 0 && <TreeView.SubTree>{renderNodes(children, matched)}</TreeView.SubTree>}
        </TreeView.Item>
      )
    })

  return (
    <div
      className={styles.tree}
      data-testid={testId}
      onFocusCapture={onFocusedRowChange ? (e) => onFocusedRowChange(rowFrom(e.target)) : undefined}
      onBlur={onFocusedRowChange ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) onFocusedRowChange(null) } : undefined}
      onKeyDown={openMenuFromKeyboard}
    >
      <TreeView aria-label={ariaLabel}>{renderNodes(roots)}</TreeView>
      {/* A host that supplies onOpenContextMenu owns rendering the menu
          itself (see the prop's own doc above) -- this tree must never
          also render one, or a row would show two. */}
      {!onOpenContextMenu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
