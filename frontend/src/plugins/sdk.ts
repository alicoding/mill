// The plugin-facing surface: every type an out-of-tree plugin's own
// code sees. This module may import NOTHING from Mill's own app code
// (no generated bindings, no services, no internal app modules),
// because its contents describe what a plugin receives, and a plugin
// receives capabilities only through the api object handed to
// activate(), never through an import.
//
// Split by contribution kind under sdk/ -- one file per manifest
// contribution (canvas objects, commands, settings, views, captures)
// plus the cross-cutting pieces every one of them shares (theme,
// guarded actions, board content). This file is the one public entry
// point every import (inside Mill and in a plugin's own JSDoc
// @param annotations) keeps using.

export * from './sdk/theme'
export * from './sdk/guardedAction'
export * from './sdk/canvasObjects'
export * from './sdk/commands'
export * from './sdk/settings'
export * from './sdk/notify'
export * from './sdk/storage'
export * from './sdk/content'
export * from './sdk/frame'
export * from './sdk/views'
export * from './sdk/captures'
export * from './sdk/ui'
export * from './sdk/api'
