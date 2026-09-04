import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AtlasService, CompanionService, ConfigureService, ExecutionService, RunKind } from '../shared/bindings'
import type { ClipbridgeReplyPreview } from '../shared/bindings'
import type { AIProvider } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'

// One turn of the panel's own transcript -- discarded on close (goal
// 0101 slice 1's own "closing the panel discards it" contract), so
// this lives only in component state, never persisted.
export interface CompanionTranscriptEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  preview?: ClipbridgeReplyPreview
  accepted?: boolean
}

let nextEntryID = 0
const newEntryID = () => `companion-${++nextEntryID}`

interface PendingTurn {
  entries: CompanionTranscriptEntry[]
  system: string
}

// The panel's own conversation state and network calls -- kept out of
// CompanionPanel.tsx so that file stays focused on layout/rendering.
export function useCompanionChat(viewedID: string) {
  const [providers, setProviders] = useState<AIProvider[] | null>(null)
  const [providerID, setProviderID] = useState('')
  const [entries, setEntries] = useState<CompanionTranscriptEntry[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRetry = useRef<PendingTurn | null>(null)

  useEffect(() => {
    void ConfigureService.AIProviders().then((list) => {
      const found = list ?? []
      setProviders(found)
      setProviderID((current) => current || found[0]?.ID || '')
    })
  }, [])

  // Runs one network turn against providerID: streams deltas as they
  // arrive (companion-delta events, live only while this call is in
  // flight -- the composer disables during it, so no correlation id is
  // needed), then appends the completed reply as a new assistant
  // entry. entriesForTurn is the FULL history including the just-added
  // user turn, computed by the caller into a local value before this
  // runs -- never re-read from state, which wouldn't yet reflect a
  // just-dispatched setEntries.
  const runTurn = useCallback(async (entriesForTurn: CompanionTranscriptEntry[], system: string) => {
    setBusy(true)
    setError(null)
    setStreamingText('')
    const off = Events.On('companion-delta', (evt) => {
      if (evt.data.text) setStreamingText((s) => s + evt.data.text)
    })
    const history = entriesForTurn.map((e) => ({ role: e.role, content: e.content }))
    try {
      const reply = await CompanionService.SendMessage(providerID, system, history)
      setEntries((cur) => [...cur, { id: newEntryID(), role: 'assistant', content: reply.Text, preview: reply.Preview }])
      pendingRetry.current = null
    } catch (err) {
      setError(String(err))
      pendingRetry.current = { entries: entriesForTurn, system }
    } finally {
      off()
      setStreamingText('')
      setBusy(false)
    }
  }, [providerID])

  // Sends text as the next user turn. When the prior assistant turn
  // proposed actions the user hasn't accepted, this is a correction --
  // the system context becomes CorrectionEnvelope (re-propose, never
  // edit-in-place) naming what the prior attempt got wrong (its
  // Errors, when it failed validation) and which of its proposed cards
  // are being superseded by this new message, so the model tries
  // again rather than silently repeating itself.
  const sendMessage = useCallback((text: string) => {
    if (busy || !text.trim() || !providerID) return
    const userEntry: CompanionTranscriptEntry = { id: newEntryID(), role: 'user', content: text }
    const nextEntries = [...entries, userEntry]
    setEntries(nextEntries)

    const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant')
    const isCorrection = !!lastAssistant?.preview?.Recognized && !lastAssistant.accepted
    const systemPromise = isCorrection
      ? AtlasService.CorrectionEnvelope(
        lastAssistant?.preview?.Errors ?? [],
        (lastAssistant?.preview?.Cards ?? []).map((c) => c.Draft.title),
      )
      : AtlasService.SpaceContextEnvelope(viewedID)

    void systemPromise
      .then((system) => runTurn(nextEntries, system))
      .catch((err) => setError(String(err)))
  }, [busy, entries, providerID, viewedID, runTurn])

  const retry = useCallback(() => {
    if (pendingRetry.current) void runTurn(pendingRetry.current.entries, pendingRetry.current.system)
  }, [runTurn])

  // Accept materializes through the SAME review plane the quick panel
  // uses (ExecutionService.RunWorkflow against the reply's own
  // RouteWorkflowID) -- never a second write path.
  const acceptProposal = useCallback(async (entryID: string, accepted: Set<number>) => {
    const entry = entries.find((e) => e.id === entryID)
    if (!entry?.preview || busy) return
    const preview = entry.preview
    const isNoteRoute = (preview.NoteTexts ?? []).length > 0
    const items = isNoteRoute
      ? (preview.NoteTexts ?? []).map((text) => ({ text }))
      : (preview.Cards ?? []).filter((_, i) => accepted.has(i)).map((c) => ({
        title: c.Draft.title,
        ...(c.Draft.kind ? { kind: c.Draft.kind } : {}),
        ...(c.Draft.note ? { note: c.Draft.note } : {}),
        ...(c.Draft.summary ? { summary: c.Draft.summary } : {}),
      }))
    if (items.length === 0 || !preview.RouteWorkflowID) return
    setBusy(true)
    setError(null)
    try {
      // parentId threads the space the user was actually viewing when
      // the context envelope was built -- the create-cards route reads
      // it (an unused extra value for the note route, which always
      // lands in the Scratchpad) so a card lands where the user is
      // looking, not always at the board root.
      const summary = await ExecutionService.RunWorkflow(preview.RouteWorkflowID, RunKind.RunKindTest, { items: JSON.stringify(items), parentId: viewedID })
      if (summary.status !== 'SUCCESS') {
        setError(`The workflow run ended with status ${summary.status}.`)
        return
      }
      setEntries((cur) => cur.map((e) => (e.id === entryID ? { ...e, accepted: true } : e)))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }, [entries, busy, viewedID])

  return { providers, providerID, setProviderID, entries, streamingText, busy, error, sendMessage, retry, acceptProposal }
}
