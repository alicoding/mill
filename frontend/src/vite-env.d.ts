/// <reference types="vite/client" />

// Injected by vite.config.ts's define -- the repo HEAD the bundle was
// compiled from ('' outside a git checkout).
declare const __MILL_REPO_HEAD__: string

// Injected by vite.config.ts's define -- true only when this bundle
// was built with MILL_DRIVE_BRIDGE=1 (shared/driveBridge.ts).
declare const __MILL_DRIVE_BRIDGE__: boolean
