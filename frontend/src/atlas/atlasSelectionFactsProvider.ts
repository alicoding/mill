import i18n from 'i18next'
import { installAtlasFacts } from '../shared/atlasSelectionFacts'
import { useAtlasStore } from './atlasStore'
import { isGroupCard } from './atlasBoardLayout'
import { exportersForCard } from './atlasUnits'
import { boardObjectContentFor, thirdPartyNounFor } from './atlasNounRegistry'
import { resolveEditRoute } from './objectSeams'

// The adapter behind shared/atlasSelectionFacts.ts (goal 0346 slice B):
// answers a selection command's questions about a card, note, object
// or link from the Atlas store and the noun registry -- the two things
// a dependency-cruiser leaf can never import. Installed once at module
// load; AtlasView imports this file for that side effect.
installAtlasFacts({
  card: (id) => {
    const { cards, notes, objects } = useAtlasStore.getState()
    const card = cards?.find((c) => c.ID === id)
    if (!card) return undefined
    return {
      id: card.ID,
      title: card.Title,
      source: card.Source ?? '',
      mirrorPath: Boolean(card.MirrorPath),
      isGroup: isGroupCard(cards ?? [], card, notes ?? [], objects ?? []),
      projection: Boolean(card.ProjectionListID),
      root: card.ParentID === '',
      exporters: exportersForCard(card, i18n.t('atlas:export.originalFile')).map((e) => ({ format: e.format, label: e.label })),
    }
  },
  note: (id) => (useAtlasStore.getState().notes ?? []).some((n) => n.ID === id),
  object: (id) => {
    const object = (useAtlasStore.getState().objects ?? []).find((o) => o.ID === id)
    if (!object) return undefined
    const content = boardObjectContentFor(object.Kind)
    const editRoute = content?.editRoute
    return {
      id: object.ID,
      kind: object.Kind,
      rename: object.Kind === 'table',
      openInDefaultApp: Boolean(content?.fileBacked && object.Payload?.mirrorPath),
      editDiagram: Boolean(editRoute) && resolveEditRoute(object, editRoute!).kind === 'embedded-engine',
      fitDiagram: content?.overflowChip === true,
      pluginItems: (thirdPartyNounFor(object.Kind)?.menuItems ?? []).filter((item) => item.enabled(object)).map((item) => ({ id: item.id, label: item.label })),
    }
  },
  link: (id) => {
    const { links, cards } = useAtlasStore.getState()
    const link = links?.find((l) => l.ID === id)
    if (!link) return undefined
    const title = (cardID: string) => cards?.find((c) => c.ID === cardID)?.Title ?? ''
    return { id: link.ID, sourceId: link.FromCardID, sourceTitle: title(link.FromCardID), targetId: link.ToCardID, targetTitle: title(link.ToCardID), label: link.Label ?? '' }
  },
  linkKinds: () => (useAtlasStore.getState().linkKinds ?? []).map((k) => ({ id: k.ID, label: k.Label })),
  perspectives: () => (useAtlasStore.getState().perspectives ?? []).map((p) => ({ id: p.ID, name: p.Name, members: p.MemberCardIDs ?? [] })),
})
