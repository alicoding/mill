import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { BrowseResult, MarketplaceSource } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

type Mutation = 'add' | 'remove' | 'refresh' | null

interface ExtensionSourcesState {
  sources: MarketplaceSource[]
  ready: boolean
  loading: boolean
  error: string
  mutation: Mutation
  completionRevision: number
  confirmedIncarnation: string
  readRevision: number
  browse: BrowseResult | null
  browseLoading: boolean
  browseError: string
  browseReadRevision: number
  browseQuery: string
  browseKinds: string[]
  loadBrowse: () => Promise<boolean>
  setBrowseQuery: (query: string) => void
  setBrowseKinds: (kinds: string[]) => void
  clearBrowseFilters: () => void
  load: () => Promise<boolean>
  add: (locator: string) => Promise<void>
  remove: (name: string, incarnation: string) => Promise<void>
  refresh: () => Promise<string[]>
  confirmRemoval: (incarnation: string) => void
  clearRemoval: () => void
}

export const useExtensionSourcesStore = create<ExtensionSourcesState>()((set, get) => ({
  sources: [],
  ready: false,
  loading: false,
  error: '',
  mutation: null,
  completionRevision: 0,
  confirmedIncarnation: '',
  readRevision: 0,
  browse: null,
  browseLoading: false,
  browseError: '',
  browseReadRevision: 0,
  browseQuery: '',
  browseKinds: [],
  load: async () => {
    const request = get().readRevision + 1
    set({ readRevision: request, loading: true })
    try {
      const sources = await PluginService.ListMarketplaceSources()
      if (get().readRevision !== request) return false
      set({ sources: sources ?? [], ready: true, loading: false, error: '' })
      return true
    } catch (error) {
      if (get().readRevision !== request) return false
      set({ ready: false, loading: false, error: String(error) })
      return false
    }
  },
  loadBrowse: async () => {
    const request = get().browseReadRevision + 1
    set({ browseReadRevision: request, browseLoading: true })
    try {
      const browse = await PluginService.BrowseMarketplaces()
      if (get().browseReadRevision !== request) return false
      set({ browse, browseLoading: false, browseError: '' })
      return true
    } catch (error) {
      if (get().browseReadRevision !== request) return false
      set({ browseLoading: false, browseError: String(error) })
      return false
    }
  },
  setBrowseQuery: (browseQuery) => set({ browseQuery }),
  setBrowseKinds: (browseKinds) => set({ browseKinds }),
  clearBrowseFilters: () => set({ browseQuery: '', browseKinds: [] }),
  add: async (locator) => {
    if (get().mutation !== null) throw new Error('A source change is already in progress.')
    set({ mutation: 'add' })
    try {
      await PluginService.AddMarketplaceSource(locator)
      set((state) => ({ completionRevision: state.completionRevision + 1 }))
    } finally {
      set({ mutation: null })
    }
  },
  remove: async (name, incarnation) => {
    if (get().mutation !== null) throw new Error('A source change is already in progress.')
    set({ mutation: 'remove' })
    try {
      await PluginService.RemoveMarketplaceSource(name, incarnation)
      set((state) => ({ completionRevision: state.completionRevision + 1, confirmedIncarnation: '' }))
    } finally {
      set({ mutation: null })
    }
  },
  refresh: async () => {
    if (get().mutation !== null) throw new Error('A source change is already in progress.')
    set({ mutation: 'refresh' })
    try {
      const problems = await PluginService.RefreshMarketplaceSources()
      set((state) => ({ completionRevision: state.completionRevision + 1 }))
      return problems ?? []
    } catch (error) {
      set((state) => ({ completionRevision: state.completionRevision + 1 }))
      throw error
    } finally {
      set({ mutation: null })
    }
  },
  confirmRemoval: (confirmedIncarnation) => set({ confirmedIncarnation }),
  clearRemoval: () => set({ confirmedIncarnation: '' }),
}))
