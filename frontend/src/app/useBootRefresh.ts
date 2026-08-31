import { useEffect } from 'react'
import { refreshKeybindings, refreshNodeTypes, refreshRequests, refreshWorkflows } from '../shared/store'
import { refreshVaultStatus } from '../shared/vaultStatusStore'
import { refreshDisabledExtensions } from '../shared/extensionEnablementStore'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'

// The one boot-time fetch of every store-owned server dataset -- split
// out of App.tsx at CLAUDE.md's 500-line convention, zero behavior
// change (the same seam useDataChangedRouter's own split follows).
// Each dataset is refetched later by whichever surface mutates it (or
// by the data-changed router); this hook only makes first render
// honest: sidebar workflows, work-tab editors' nodeTypes/requests,
// keybindings, the vault-lock door, disabled-extension ids for the
// tray/palette, and per-extension declared-setting values (goal 0258
// -- a canvas surface reads extensionSetting() synchronously at
// mount).
export function useBootRefresh(): void {
  useEffect(() => {
    void refreshWorkflows()
    void refreshNodeTypes()
    void refreshRequests()
    void refreshKeybindings()
    void refreshVaultStatus()
    void refreshDisabledExtensions()
    void refreshExtensionSettings()
  }, [])
}
