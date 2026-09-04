import { describe, expect, it } from 'vitest'
import views from '../locales/en/views.json'

// The caption budget (goal 0321, .claude/rules/ux-writing.md): a field
// caption states ONE idea and targets ~100 characters. Four Settings
// captions had run 170-293 characters, which is documentation, not
// copy -- what a caption cannot say in 100 characters goes behind a
// "Learn more" link to the Docs page that carries it.
//
// The keys are listed EXPLICITLY rather than pattern-matched: this
// file's job is to name every string Settings renders as a caption,
// so adding a caption without adding it here is a review question, not
// a silent pass. Error and status strings are deliberately absent --
// they carry a failure's actual detail and are not captions.
const CAPTION_KEYS = [
  'settings.general.launchAtLoginCaption',
  'settings.general.canvasNavigationTrackpadCaption',
  'settings.general.canvasNavigationMouseCaption',
  'settings.general.saveModeAutomaticCaption',
  'settings.general.saveModeExplicitCaption',
  'settings.appearance.lightSchemeCaption',
  'settings.appearance.darkSchemeCaption',
  'settings.keyboardShortcuts.description',
  'settings.globalHotkey.description',
  'settings.mcp.addressCaption',
  'settings.mcp.addressEnvOverrideCaption',
  'settings.mcp.allowImportCaption',
  'settings.mcp.askBeforeImportCaption',
  'settings.remoteAccess.description',
  'settings.remoteAccess.macAlwaysAllowed',
  'settings.remoteAccess.notify.caption',
  'settings.remoteAccess.phone.caption',
  'settings.remoteAccess.phone.secretNote',
  'settings.contract.description',
  'settings.contract.exportSkillDescription',
  'settings.notifications.awayAfterCaption',
  'settings.notifications.alertPermissionNote',
  'settings.dataStewardship.description',
  'settings.dataStewardship.syncedFolderWarning',
  'settings.dataStewardship.mirrorFilesNote',
  'settings.updates.autoCheckCaption',
  'settings.updates.proxyCaption',
  'settings.updates.resignNotice',
  'settings.updates.resignSetupNotice',
  'settings.updates.sourceUpdateHint',
  'settings.updates.installFallbackHint',
  'settings.extensions.subtitle',
  'settings.extensions.installHint',
  'settings.extensions.reviewHint',
  'settings.extensions.linkPasteCaption',
] as const

const MAX_CAPTION_LENGTH = 100

function lookup(path: string): string {
  let node: unknown = views
  for (const part of path.split('.')) {
    expect(typeof node, `${path} resolves through an object`).toBe('object')
    node = (node as Record<string, unknown>)[part]
  }
  expect(typeof node, `${path} exists in views.json`).toBe('string')
  return node as string
}

describe('Settings caption budget', () => {
  it.each(CAPTION_KEYS)('%s stays within the caption budget', (key) => {
    const text = lookup(key)
    expect(text.length, `${key} is ${text.length} characters: "${text}"`).toBeLessThanOrEqual(MAX_CAPTION_LENGTH)
  })
})
