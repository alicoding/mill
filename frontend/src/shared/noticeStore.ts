import { create } from 'zustand'

// The app-notice channel (goal 0277, the multi-purpose surface goal
// 0122's pill was always meant to be): ONE list of notices the footer
// pill renders, whoever pushed them. Update states are DERIVED into
// this shape by updateNotices.ts (the first consumer, migrated);
// plugins PUSH into it through api.notify (the second); any future
// consumer pushes the same shape rather than growing a sibling widget.
export type NoticeLevel = 'info' | 'success' | 'warning' | 'error' | 'progress'

export interface NoticeAction {
  // id names the action stably (the pill renders it as
  // `notice-<id>`); omitted for an action nothing needs to address.
  id?: string
  label: string
  commandId: string
}

export interface Notice {
  id: string
  level: NoticeLevel
  text: string
  // source is a machine tag naming what pushed the notice (a command
  // id, a plugin id). It is never rendered: a notice whose origin the
  // reader needs carries that word in its own text instead.
  source?: string
  // primaryCommandId turns the text itself into the notice's one
  // primary action (the update pill's download/relaunch shape).
  primaryCommandId?: string
  // actions render as lighter secondary links after the text.
  actions?: NoticeAction[]
  // onDismiss renders the × and runs when it is clicked; absent means
  // the notice is not dismissible by hand (it leaves when its state
  // does, or on its own timer).
  onDismiss?: () => void
}

interface NoticeState {
  notices: Notice[]
  push: (n: Notice) => void
  remove: (id: string) => void
}

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  push: (n) => set((s) => ({ notices: [...s.notices.filter((x) => x.id !== n.id), n] })),
  remove: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),
}))

// Long enough to read one short sentence, short enough that the
// footer never feels stuck (the converged transient-toast range) --
// the same window the update pill's "up to date" notice already uses.
export const TRANSIENT_NOTICE_MS = 6000

let counter = 0

export interface PushNoticeInput {
  text: string
  level?: NoticeLevel
  source?: string
  actions?: NoticeAction[]
  // ttlMs overrides the level default: info/success leave on their
  // own after TRANSIENT_NOTICE_MS; warning/error/progress stay until
  // dismissed or removed. 0 means never auto-dismiss.
  ttlMs?: number
}

// pushNotice adds a dismissible notice and returns its dismiss
// function -- the one door every non-update consumer uses.
export function pushNotice(input: PushNoticeInput): () => void {
  const id = `pushed-${++counter}`
  const level = input.level ?? 'info'
  const remove = () => useNoticeStore.getState().remove(id)
  useNoticeStore.getState().push({
    id,
    level,
    text: input.text,
    source: input.source,
    actions: input.actions,
    onDismiss: remove,
  })
  const ttl = input.ttlMs ?? (level === 'info' || level === 'success' ? TRANSIENT_NOTICE_MS : 0)
  if (ttl > 0) setTimeout(remove, ttl)
  return remove
}
