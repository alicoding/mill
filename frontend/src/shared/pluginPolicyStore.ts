import { useEffect } from 'react'
import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PolicyView } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { background } from './background'

// The organisation's extension policy as the surfaces read it (goal
// 0349 S6): one store, the same second-store-file placement
// extensionEnablementStore.ts follows, because the Extensions banner,
// the install prompt and Settings > Security all show the same file
// and must never disagree about it. Read fresh on every mount of a
// consumer -- the file is device-managed and can change under Mill.
interface PluginPolicyState {
  policy: PolicyView | null
  setPolicy: (policy: PolicyView | null) => void
}

export const usePluginPolicyStore = create<PluginPolicyState>()((set) => ({
  policy: null,
  setPolicy: (policy) => set({ policy }),
}))

export function refreshPluginPolicy(): Promise<void> {
  return background(PluginService.PluginPolicy()
    .then((policy) => usePluginPolicyStore.getState().setPolicy(policy))
    .catch(() => usePluginPolicyStore.getState().setPolicy(null)), 'pluginPolicy.read')
}

// usePluginPolicy reads the policy and refreshes it on mount.
export function usePluginPolicy(): PolicyView | null {
  const policy = usePluginPolicyStore((s) => s.policy)
  useEffect(() => { void refreshPluginPolicy() }, [])
  return policy
}
