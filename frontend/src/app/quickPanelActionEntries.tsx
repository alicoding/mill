import type { ElementType, ReactNode } from 'react'
import { CounterLabel } from '@primer/react'
import { CopyIcon, GearIcon, HomeIcon } from '@primer/octicons-react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import { ENTITY_ICON } from '../shared/entityIcons'
import type { PaletteSearchable } from './paletteFilter'
import { CAPABILITY_ICON } from './navIcon'
import { HotkeyHint } from './HotkeyHint'

// Split out of QuickPanel.tsx (architecture.md's 500-line convention)
// along the real seam between the two entry kinds the panel renders:
// workflow rows (QuickPanel.tsx's own useMemo, needs per-row pin/
// hotkey-chip state) versus these Configure-jump + fixed-action rows,
// which are pure derivations from already-fetched entity lists and a
// handful of stable callbacks -- no hook state of their own.

export type PanelGroupId = 'workflows' | 'configure' | 'atlas' | 'actions'

export interface PanelEntry extends PaletteSearchable {
  id: string
  groupId: PanelGroupId
  text: string
  description?: string
  leadingVisual: ElementType
  trailingVisual?: ReactNode
  run: () => void
}

// docs/goals/0015-summon-quick-invoke.md's remainder, items 2/3: the
// Configure-entity jump rows (connectors/Lists/MCP Servers, each
// landing the main window on its own tab) plus the panel's fixed
// action rows (Open Mill, Open Settings, Review with its live pending
// count, Apply-from-clipboard). t is react-i18next's translator;
// jumpToConfigure/openMain/applyFromClipboard are QuickPanel.tsx's own
// stable callbacks, passed through rather than reimplemented here.
export function buildConfigureAndActionEntries(params: {
  t: (key: string, opts?: Record<string, unknown>) => string
  requests: HTTPRequest[] | null | undefined
  lists: List[] | null | undefined
  mcpServers: MCPServer[] | null | undefined
  atlasCards: Card[] | null | undefined
  atlasKinds: Kind[] | null | undefined
  reviewPendingCount: number
  jumpToConfigure: (tab: string) => void
  jumpToAtlasCard: (cardID: string) => void
  openMain: (view: string) => void
  applyFromClipboard: () => void
}): PanelEntry[] {
  const { t, requests, lists, mcpServers, atlasCards, atlasKinds, reviewPendingCount, jumpToConfigure, jumpToAtlasCard, openMain, applyFromClipboard } = params
  const entries: PanelEntry[] = []
  const atlasKindByID = new Map((atlasKinds ?? []).map((k) => [k.ID, k]))

  for (const req of requests ?? []) {
    entries.push({
      id: `configure:integration:${req.ID}`,
      groupId: 'configure',
      text: req.Label,
      description: t('quickPanel.entries.jumpToIntegration'),
      searchText: req.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.request.Icon,
      run: () => jumpToConfigure('integration'),
    })
  }
  for (const list of lists ?? []) {
    entries.push({
      id: `configure:lists:${list.ID}`,
      groupId: 'configure',
      text: list.Label,
      description: t('quickPanel.entries.jumpToLists'),
      searchText: list.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.list.Icon,
      run: () => jumpToConfigure('lists'),
    })
  }
  for (const server of mcpServers ?? []) {
    entries.push({
      id: `configure:mcpservers:${server.ID}`,
      groupId: 'configure',
      text: server.Label,
      description: t('quickPanel.entries.jumpToMcpServers'),
      searchText: server.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.mcpserver.Icon,
      run: () => jumpToConfigure('mcpservers'),
    })
  }

  // Atlas card search (docs/goals/0061 item 6, ADR-0038): search is the
  // door into a space -- selecting a row opens the main window on the
  // Atlas surface already drilled to the card's parent, with the card's
  // own overlay open (App.tsx's useMillNavigate parses 'atlas:<cardID>').
  for (const card of atlasCards ?? []) {
    const kind = atlasKindByID.get(card.KindID)
    entries.push({
      id: `atlas:${card.ID}`,
      groupId: 'atlas',
      text: card.Title,
      description: kind ? t('quickPanel.entries.jumpToAtlasCard', { kind: kind.Label }) : undefined,
      searchText: card.Title.toLowerCase(),
      leadingVisual: CAPABILITY_ICON['capability-atlas'],
      run: () => jumpToAtlasCard(card.ID),
    })
  }

  entries.push({
    id: 'open-mill',
    groupId: 'actions',
    text: t('quickPanel.entries.openMill'),
    searchText: 'open mill window',
    leadingVisual: HomeIcon,
    run: () => openMain(''),
  })
  entries.push({
    id: 'open-settings',
    groupId: 'actions',
    text: t('quickPanel.entries.openSettings'),
    searchText: 'open settings preferences',
    leadingVisual: GearIcon,
    // HotkeyHint (app/HotkeyHint.tsx) reads settings.open's live
    // effective binding (shared/commands.ts + any Settings override) --
    // never a hardcoded combo that could silently go stale on a rebind.
    trailingVisual: <HotkeyHint commandId="settings.open" />,
    run: () => openMain('settings'),
  })
  // "Review" is always present (unblock-yourself-in-place -- a real
  // jump target even at zero), badged with the live count once non-zero.
  entries.push({
    id: 'open-review',
    groupId: 'actions',
    text: t('quickPanel.entries.review'),
    description: reviewPendingCount > 0 ? t('quickPanel.entries.reviewPendingDescription', { count: reviewPendingCount }) : t('quickPanel.entries.reviewNoPending'),
    searchText: 'review pending approval guardrail mcp write',
    leadingVisual: CAPABILITY_ICON['capability-review'],
    trailingVisual: reviewPendingCount > 0 ? (
      <CounterLabel data-testid="quick-panel-review-count" aria-label={t('reviewPendingAriaLabel', { count: reviewPendingCount })}>
        {reviewPendingCount}
      </CounterLabel>
    ) : undefined,
    run: () => openMain('review'),
  })
  // docs/goals/0039: always present, same unblock-yourself-in-place
  // reasoning as Review above -- clipboard+hotkey is the fallback path
  // into Mill when MCP itself is unavailable (a locked-down enterprise
  // environment). trailingVisual shows panel.applyClipboard's bound key
  // once the user rebinds it (shared/commands.ts's defaultBinding is
  // null); HotkeyHint renders nothing until then.
  entries.push({
    id: 'apply-clipboard',
    groupId: 'actions',
    text: t('quickPanel.entries.applyFromClipboard'),
    description: t('quickPanel.entries.applyFromClipboardDescription'),
    searchText: 'apply from clipboard import paste workflow export',
    leadingVisual: CopyIcon,
    trailingVisual: <HotkeyHint commandId="panel.applyClipboard" />,
    run: applyFromClipboard,
  })

  return entries
}
