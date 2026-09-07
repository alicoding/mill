import { z } from 'zod'

// index.html's script-src forbids 'unsafe-eval' (goal 0375 S1a). zod's
// own allowsEval() capability probe (`new Function("")` inside a
// try/catch, cached per module instance) still fires a
// securitypolicyviolation report even though the throw it catches
// never surfaces -- `jitless` skips the probe entirely and zod uses
// its interpreted (non-JIT) validators, the setting zod's own source
// documents for exactly a strict-CSP host.
//
// A standalone, side-effect-only module rather than a statement inside
// main.tsx's own body: ES module evaluation runs an importing module's
// OWN top-level statements only after every one of its imports has
// already run, so a plain `z.config(...)` call placed among main.tsx's
// later statements would run after modules it imports earlier in that
// same file (e.g. App.tsx's own transitive graph, which parses a
// schema at ITS module-evaluation time) already triggered the probe.
// Importing this file FIRST -- before any other import in main.tsx --
// runs this side effect before any later sibling import is even
// reached, per the same evaluation order.
z.config({ jitless: true })
