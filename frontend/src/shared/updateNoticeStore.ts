import { create } from 'zustand'
import { SettingsService, UpdateState } from './bindings'

// The update-notice state door (goal 0222 S1): app/NoticePill.tsx used
// to hold SettingsService.UpdateNoticeState()'s result in its own local
// useState, unreachable outside that one component -- update.
// downloadAndInstall/relaunch's enablement predicates (shared/
// settingsCommands.ts) need the same truth synchronously, so it's
// lifted here, same "second store file" placement vaultStatusStore.ts
// uses for the identical reason.
interface UpdateNoticeState {
  updateNoticeState: UpdateState
  setUpdateNoticeState: (state: UpdateState) => void
  // notesVersion/notesHTML (goal 0220 S2): the "What's new" surface's
  // whole data source, lifted here for the identical reason
  // updateNoticeState itself was -- app/WhatsNewDialog.tsx (opened from
  // either the pill or Settings) needs the same server-rendered notes
  // NoticePill's own mount/event refresh already fetches, without a
  // second CheckForUpdates round trip.
  notesVersion: string
  notesHTML: string
  setNotes: (version: string, html: string) => void
  // Trust-signing action feedback (goal 0220 S3): update.trustSigning's
  // run() (shared/settingsCommands.ts) is the ONE place that calls
  // SettingsService.TrustSigningIdentity, so its busy/success/error
  // result lives here too -- views/TrustDisclosure.tsx reads it the
  // same way NoticePill already reads updateNoticeState, rather than
  // the button owning a second call to the same RPC.
  trustSigningStatus: 'idle' | 'busy' | 'success' | 'error'
  trustSigningError: string
  runTrustSigning: () => void
}

export const useUpdateNoticeStore = create<UpdateNoticeState>()((set) => ({
  updateNoticeState: UpdateState.UpdateStateIdle,
  setUpdateNoticeState: (state) => set({ updateNoticeState: state }),
  notesVersion: '',
  notesHTML: '',
  setNotes: (notesVersion, notesHTML) => set({ notesVersion, notesHTML }),
  trustSigningStatus: 'idle',
  trustSigningError: '',
  runTrustSigning: () => {
    set({ trustSigningStatus: 'busy', trustSigningError: '' })
    SettingsService.TrustSigningIdentity()
      .then(() => set({ trustSigningStatus: 'success' }))
      .catch((err) => set({ trustSigningStatus: 'error', trustSigningError: String(err) }))
  },
}))

// The one refetch path -- NoticePill's own mount/event refresh and
// update.check's run() (shared/settingsCommands.ts) both call this
// rather than each re-deriving it, so pill/palette/keyboard read the
// exact same value.
export function refreshUpdateNoticeState(): Promise<void> {
  return SettingsService.UpdateNoticeState()
    .then((n) => {
      useUpdateNoticeStore.getState().setUpdateNoticeState(n.state)
      useUpdateNoticeStore.getState().setNotes(n.notesVersion, n.notesHTML)
    })
    .catch(console.error)
}
