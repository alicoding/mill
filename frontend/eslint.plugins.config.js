// The plugin standard's rule 15 (no remote code) and rule 15's
// markup-injection corollary, checked over the shipped examples --
// the same code an out-of-tree author copies as a starting point, so
// it must itself be the example of the rule. Deliberately a SEPARATE
// flat config from eslint.config.js: the examples are plain ESM
// script files outside frontend's own TypeScript project, loaded as
// classic <script type="module"> with no bundler and no tsconfig
// coverage.
import globals from 'globals'

const markupInjectionSelectors = [
  {
    selector: "AssignmentExpression[left.property.name='innerHTML']",
    message: 'Build DOM nodes or use textContent -- innerHTML can inject markup from data the plugin does not control.',
  },
  {
    selector: "AssignmentExpression[left.property.name='outerHTML']",
    message: 'Build DOM nodes or use textContent -- outerHTML can inject markup from data the plugin does not control.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'Build DOM nodes or use textContent -- insertAdjacentHTML can inject markup from data the plugin does not control.',
  },
]

export default [
  {
    files: ['examples/plugins/*/main.js', 'examples/plugins/*/steps.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // steps.js runs inside Mill's own workflow executor, which
        // calls registerStep as a global rather than an import.
        registerStep: 'readonly',
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-restricted-syntax': ['error', ...markupInjectionSelectors],
    },
  },
]
