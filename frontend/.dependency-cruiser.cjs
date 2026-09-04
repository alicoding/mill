/** @type {import('dependency-cruiser').IConfiguration} */
// docs/adr/0012: enforces the bounded-context folder structure under
// src/ -- app/views/composition/configure/shared -- as real dependency
// rules, not just a documented convention. Chosen over
// eslint-plugin-boundaries (tried first, real integration issue with
// its element-pattern matching in this project's setup that its own
// maintained test suite didn't reproduce, not worth more time chasing):
// dependency-cruiser is a standalone CLI with a simpler regex from/to
// model, run the same way scripts/check-loc.sh already is (Lefthook +
// CI), not a second ESLint-plugin-resolution surface to debug.
module.exports = {
  forbidden: [
    {
      name: 'shared-is-a-leaf',
      severity: 'error',
      comment: 'shared/ must not depend on any other bounded-context folder',
      from: { path: '^src/shared' },
      to: { path: '^src/(app|views|composition|configure|atlas)' },
    },
    {
      name: 'configure-must-not-depend-on-composition',
      severity: 'error',
      comment: 'configure/ is a lower layer than composition/ -- composition may reference configure (a workflow node references a configured entity), never the reverse',
      from: { path: '^src/configure' },
      to: { path: '^src/composition' },
    },
    {
      name: 'configure-must-not-depend-on-atlas',
      severity: 'error',
      comment: 'configure/ is a lower layer than atlas/ (ADR-0038: Atlas reuses configure/EntityRefField for its refresh-workflow picker), never the reverse',
      from: { path: '^src/configure' },
      to: { path: '^src/atlas' },
    },
    {
      name: 'atlas-must-not-depend-on-composition',
      severity: 'error',
      comment: 'atlas/ (ADR-0038 spaces/cards) and composition/ (workflow canvas) are sibling domain surfaces over configure/ + shared/, neither reaches into the other',
      from: { path: '^src/atlas' },
      to: { path: '^src/composition' },
    },
    {
      name: 'composition-must-not-depend-on-atlas',
      severity: 'error',
      comment: 'the reverse direction of atlas-must-not-depend-on-composition, kept as its own rule so either import direction is reported by name',
      from: { path: '^src/composition' },
      to: { path: '^src/atlas' },
    },
    {
      name: 'domain-folders-must-not-depend-on-views-or-app',
      severity: 'error',
      comment: 'composition/, configure/, and atlas/ are domain UI, not aware of top-level pages or the app shell',
      from: { path: '^src/(composition|configure|atlas)' },
      to: { path: '^src/(views|app)' },
    },
    {
      name: 'views-must-not-depend-on-app',
      severity: 'error',
      comment: 'views/ are pages the app shell renders, not the other way around',
      from: { path: '^src/views' },
      to: { path: '^src/app' },
    },
    {
      name: 'canvas-extensions-must-not-import-kernel',
      severity: 'error',
      comment: 'ADR-0046 / goal 0244 S1b: a canvas-object extension (src/atlas/extensions/**) receives its object\'s data and mutators as host-supplied props (AtlasBoardObjectNode.tsx) -- it has no import path to a Wails-bound service (identity/persistence/undo/guardrail mutators, the kernel ADR-0046 names), whether via the shared/bindings barrel or a direct services/ binding path. Domain-model TYPE shapes (bindings/**/internal/domain/**) stay reachable -- an extension legitimately needs to know the shape of the already-loaded data it is handed.',
      from: { path: '^src/atlas/extensions' },
      to: { path: '^(src/shared/bindings\\.ts|bindings/.*/internal/services/)' },
    },
    {
      name: 'plugin-sdk-imports-nothing',
      severity: 'error',
      comment: 'ADR-0047 / goal 0249: src/plugins/sdk.ts and its src/plugins/sdk/* contribution-kind files describe exactly what an out-of-tree plugin sees, and a plugin receives capabilities only through the api object handed to activate() -- never through an import. The SDK module tree therefore imports NOTHING outside itself (kernel, bindings, or otherwise) -- only from one another; host-side plumbing lives in src/plugins/{hostApi,loader,PluginFaceContent} which legitimately reach the kernel.',
      from: { path: '^src/plugins/sdk(\\.ts$|/)' },
      to: { pathNot: '^src/plugins/sdk(\\.ts$|/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(test)\\.tsx?$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
