import { useEffect, useState } from 'react'
import { CheckIcon, NoteIcon, PlusIcon } from '@primer/octicons-react'
import type { TFunction } from 'i18next'
import { AtlasService, ConfigureService, SettingsService } from '../shared/bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginCapture } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { useAtlasStore } from '../atlas/atlasStore'
import type { PanelEntry } from './quickPanelActionEntries'
import { cascadeNotePosition, resolveNoteParentID } from './quickPanelCapture'

// The Quick Panel's capture doors: a typed query with no intent to
// search becomes a NOTE (docs/goals/0090) or a TASK ROW (docs/goals/
// 0300). Success clears the query and dismisses through the SAME
// focus-yield path the other rows use, silently -- no confirmation
// to read before the window goes away, matching capture-first's own
// "no app focus change" intent. A failure never dismisses, so the
// query stays typed and the panel's own status line carries the
// error. Both rows are panel-local by construction (the palette has
// no typed query to capture) -- the recorded exception to the
// command-is-the-atom rule, same as save-note before it.

// The seeded Task tracker's id (internal/domain/list/builtin.go) --
// hardcoded the way SEEDED_SCRATCHPAD_CARD_ID is.
export const SEEDED_TASK_TRACKER_LIST_ID = 'example-task-tracker-list'

// Today's date in the List's own date format (ISO calendar date).
export function todayISODate(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// The row a captured task lands as: the title, an open status, today
// as the scheduled date, not done -- the fields the converged task
// record fills on capture; everything else waits for the tracker.
export function taskRowForCapture(text: string, today: string): Record<string, string> {
  return { task: text, status: 'In progress', scheduled: today, done: 'false' }
}

export function useQuickPanelCaptureDoors({ t, setQuery, setStatus }: {
  t: TFunction
  setQuery: (q: string) => void
  setStatus: (s: string | null) => void
}) {
  const atlasCards = useAtlasStore((s) => s.cards)
  const atlasNotes = useAtlasStore((s) => s.notes)
  // The task door only exists while the seeded tracker does -- a
  // deleted seed removes the row rather than erroring on Enter.
  const [trackerExists, setTrackerExists] = useState(false)
  useEffect(() => {
    ConfigureService.GetList(SEEDED_TASK_TRACKER_LIST_ID)
      .then((l) => setTrackerExists(Boolean(l?.ID)))
      .catch(() => setTrackerExists(false))
  }, [])

  const dismiss = () => {
    setQuery('')
    void SettingsService.DismissPanel().catch(() => {})
  }

  const createNoteFromQuery = (text: string) => {
    const parentID = resolveNoteParentID(atlasCards)
    const position = cascadeNotePosition(atlasNotes, parentID)
    AtlasService.CreateNote(text, position, parentID)
      .then(dismiss)
      .catch(() => setStatus(t('quickPanel.saveNoteError')))
  }

  const createTaskFromQuery = (text: string) => {
    // An out-of-range index appends (AddListRowAt's own clamp).
    ConfigureService.AddListRowAt(SEEDED_TASK_TRACKER_LIST_ID, taskRowForCapture(text, todayISODate()), Number.MAX_SAFE_INTEGER)
      .then(dismiss)
      .catch(() => setStatus(t('quickPanel.saveTaskError')))
  }

  // Keyed by the query: as the rows surviving every filter change they
  // became the list's "previous" active row, stealing Enter from the
  // top result (goal 0294).
  const captureEntries = (trimmedQuery: string): PanelEntry[] => {
    if (!trimmedQuery) return []
    const entries: PanelEntry[] = [{
      id: `save-note:${trimmedQuery}`,
      groupId: 'actions',
      text: t('quickPanel.saveNote'),
      description: t('quickPanel.saveNoteHint'),
      searchText: '',
      leadingVisual: NoteIcon,
      run: () => createNoteFromQuery(trimmedQuery),
    }]
    if (trackerExists) {
      entries.push({
        id: `save-task:${trimmedQuery}`,
        groupId: 'actions',
        text: t('quickPanel.saveTask'),
        description: t('quickPanel.saveTaskHint'),
        searchText: '',
        leadingVisual: CheckIcon,
        run: () => createTaskFromQuery(trimmedQuery),
      })
    }
    return entries
  }

  // Capture launch rows (goal 0309): "New note…" and one row per plugin
  // capture declared in a manifest (declare-first -- this window runs
  // no plugin code), each summoning the capture window on that face.
  const [pluginCaptures, setPluginCaptures] = useState<PluginCapture[]>([])
  useEffect(() => {
    PluginService.Captures().then((c) => setPluginCaptures(c ?? [])).catch(() => setPluginCaptures([]))
  }, [])
  const launchCapture = (pluginId: string, captureId: string) => {
    void SettingsService.ShowCapture(pluginId, captureId).catch(() => setStatus(t('quickPanel.captureOpenError')))
    dismiss()
  }
  const captureLaunchEntries = (): PanelEntry[] => {
    const entries: PanelEntry[] = [{
      id: 'capture:note',
      groupId: 'actions',
      text: t('quickPanel.newNote'),
      description: t('quickPanel.newNoteHint'),
      searchText: `${t('quickPanel.newNote')} note capture`,
      leadingVisual: NoteIcon,
      run: () => launchCapture('', 'note'),
    }]
    for (const c of pluginCaptures) {
      entries.push({
        id: `capture:${c.pluginId}/${c.id}`,
        groupId: 'actions',
        text: t('quickPanel.newCapture', { label: c.label }),
        description: c.description || t('quickPanel.newCaptureHint', { plugin: c.pluginName }),
        searchText: `${c.label} ${c.pluginName} capture`,
        leadingVisual: PlusIcon,
        run: () => launchCapture(c.pluginId, c.id),
      })
    }
    return entries
  }

  return { captureEntries, captureLaunchEntries, pluginCaptures }
}
