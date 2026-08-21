import axeCore from 'axe-core'
import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { isScrollingOverflow } from '../src/shared/scrollContainer'
import { classifyScrollFitness, TRAPPED_OVERFLOW_THRESHOLD_PX } from './layoutFitnessPredicate'

export const LAYOUT_FITNESS_RULE_ID = 'mill-layout-scroll'
const LAYOUT_FITNESS_CHECK_ID = 'mill-layout-scroll-check'

// Registers the goal 0156 layout-fitness invariant as a genuine
// axe-core custom rule (Research -> Adopt -> Compose: @axe-core/
// playwright + axe-core do the DOM walk, node matching, and violation
// reporting -- axe.configure's own documented Spec API, never a
// parallel hand-rolled runner). The evaluate function below runs
// INSIDE the page, so it can't `import` isScrollingOverflow/
// classifyScrollFitness -- Playwright/axe only ever get a function's
// serialized source. Both are stringified and re-declared in the
// injected script instead, keeping ONE authored definition (this
// file's imports are the source of truth Node-side; the unit test in
// layoutFitnessPredicate.test.ts covers the same function these
// strings embed) rather than a second hand-copied implementation.
function buildConfigureScript(): string {
  return `
    var TRAPPED_OVERFLOW_THRESHOLD_PX = ${TRAPPED_OVERFLOW_THRESHOLD_PX}
    ${isScrollingOverflow.toString()}
    ${classifyScrollFitness.toString()}
    axe.configure({
      checks: [{
        id: '${LAYOUT_FITNESS_CHECK_ID}',
        evaluate: function (node) {
          var style = getComputedStyle(node)
          var verdict = classifyScrollFitness({
            overflowY: style.overflowY,
            overflowX: style.overflowX,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            isViewPane: node.classList.contains('view-pane'),
            hasScrollRegionAttr: node.hasAttribute('data-scroll-region'),
            hasClipIntentAncestor: node.closest('[data-clip-intent]') !== null,
            hasScrollRegionDescendant: node.querySelector('[data-scroll-region]') !== null,
          })
          // axe's own message-template lookup (checks.js) reads
          // data.messageKey to pick the right fail-message variant --
          // never set for a pass, since a pass never renders a message.
          this.data(verdict.pass ? verdict : Object.assign({ messageKey: verdict.kind }, verdict))
          return verdict.pass
        },
        metadata: {
          messages: {
            pass: 'Not a layout-fitness violation.',
            fail: {
              default: 'Layout fitness violation.',
              'undeclared-scroller': 'Undeclared scroll container: this element scrolls on its own but carries neither the .view-pane class nor a data-scroll-region attribute. Add data-scroll-region in the owning component if this is a deliberate named scroller.',
              'trapped-overflow': 'Trapped overflow: this element clips \${data.deltaPx}px of real content (over the ${TRAPPED_OVERFLOW_THRESHOLD_PX}px threshold) with no data-scroll-region descendant to handle it. Add data-clip-intent if this clamp is deliberate, or a data-scroll-region on the element that should scroll it.',
            },
          },
        },
      }],
      rules: [{
        id: '${LAYOUT_FITNESS_RULE_ID}',
        selector: '.view-pane, .view-pane *',
        any: ['${LAYOUT_FITNESS_CHECK_ID}'],
        tags: ['${LAYOUT_FITNESS_RULE_ID}'],
        metadata: {
          description: 'Every user-scrollable element under .view-pane is a named surface, and no element traps real content behind a hidden/clip ancestor.',
          help: 'Layout fitness: declare scrollers, do not trap overflow (docs/goals/0156-frontend-fitness-functions.md).',
        },
      }],
    })
  `
}

// One AxeBuilder, scoped to ONLY this custom rule -- axe-core's
// ~90 bundled a11y rules stay registered (they ship inside the
// injected axeCoreSource) but never run: withRules() sets
// runOnly:{type:'rule', values:[...]}, so nothing outside
// mill-layout-scroll's own single rule is ever evaluated. Enabling
// axe's own a11y ruleset is a deliberately separate, dormant future
// goal (see the goal file's Deferred section), not this scope.
export function layoutFitnessBuilder(page: Page): AxeBuilder {
  const axeSource = `${axeCore.source}\n${buildConfigureScript()}`
  return new AxeBuilder({ page, axeSource }).withRules([LAYOUT_FITNESS_RULE_ID])
}
