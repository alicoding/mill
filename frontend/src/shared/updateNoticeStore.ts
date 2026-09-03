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
  // Trust-disclosure visibility (owner-ruled progressive disclosure):
  // "How updates stay trusted" hides itself once trust is already
  // established, and on platforms with no signing concept at all
  // (SettingsService.IsSigningTrusted's ErrUnsupportedPlatform).
  // Defaults to visible, matching the section's behavior before this
  // read existed, and stays visible on any other read error -- if
  // trust can't be proven, the section still offers the action.
  trustDisclosureVisible: boolean
  refreshTrustDisclosureVisibility: () => void
  // User-run check feedback (goal 0275): a palette/Quick Panel/Settings
  // check the USER started must always answer -- the pill renders these
  // outcomes; automatic checks never set them, staying as quiet as
  // before. 'upToDate' auto-dismisses; 'failed' waits for the user.
  userCheck: 'idle' | 'checking' | 'upToDate' | 'failed'
  // Versions for outcome copy: the notice's own available version, and
  // the last user-started check's current version.
  availableVersion: string
  currentVersion: string
  runUserCheck: () => void
  dismissUserCheckNotice: () => void
}

// Long enough to read one short sentence, short enough that the
// footer never feels stuck (the converged transient-toast range).
const UP_TO_DATE_NOTICE_MS = 6000

export const useUpdateNoticeStore = create<UpdateNoticeState>()((set, get) => ({
  updateNoticeState: UpdateState.UpdateStateIdle,
  setUpdateNoticeState: (state) => set({ updateNoticeState: state }),
  notesVersion: '',
  notesHTML: '',
  setNotes: (notesVersion, notesHTML) => set({ notesVersion, notesHTML }),
  trustSigningStatus: 'idle',
  trustSigningError: '',
  runTrustSigning: () => {
    set({ trustSigningStatus: 'busy', trustSigningError: '' })
    return SettingsService.TrustSigningIdentity()
      .then(() => {
        set({ trustSigningStatus: 'success' })
        return get().refreshTrustDisclosureVisibility()
      })
      .catch((err) => set({ trustSigningStatus: 'error', trustSigningError: String(err) }))
  },
  userCheck: 'idle',
  availableVersion: '',
  currentVersion: '',
  runUserCheck: () => {
    set({ userCheck: 'checking' })
    SettingsService.CheckForUpdates()
      .then((result) => {
        set({ currentVersion: result.currentVersion, availableVersion: result.updateAvailable ? result.version : '' })
        return refreshUpdateNoticeState()
      })
      .then(() => {
        const landed = get().updateNoticeState
        if (landed === UpdateState.UpdateStateAvailable || landed === UpdateState.UpdateStateDownloading || landed === UpdateState.UpdateStateReady) {
          // The pill's existing states take over -- no extra notice.
          set({ userCheck: 'idle' })
          return
        }
        set({ userCheck: 'upToDate' })
        window.setTimeout(() => {
          if (get().userCheck === 'upToDate') set({ userCheck: 'idle' })
        }, UP_TO_DATE_NOTICE_MS)
      })
      .catch(() => set({ userCheck: 'failed' }))
  },
  dismissUserCheckNotice: () => set({ userCheck: 'idle' }),
  trustDisclosureVisible: true,
  refreshTrustDisclosureVisibility: () => {
    return SettingsService.IsSigningTrusted()
      .then((trusted) => set({ trustDisclosureVisible: !trusted }))
      .catch((err) => set({ trustDisclosureVisible: !String(err).includes('unsupported on this platform') }))
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
      if (n.availableVersion) useUpdateNoticeStore.setState({ availableVersion: n.availableVersion })
    })
    .catch(console.error)
}
