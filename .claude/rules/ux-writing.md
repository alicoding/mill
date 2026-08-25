# UX writing — product copy, not spec narrative

No `paths` frontmatter — copy shows up in locale JSON, seeded entity
descriptions, and occasionally component fallbacks, so this loads
unconditionally like architecture.md.

UI copy tells the user what they can do and what happens next, in their
vocabulary — never the system's internals. The bar is the converged
industry conventions (Material Design's writing guidance, Apple HIG's
writing style, Nielsen Norman Group's microcopy research):

- **Front-load the action or outcome.** First words carry the verb or the
  benefit; qualifiers come after, if at all.
- **One idea per sentence; one sentence per caption.** A page subtitle is
  one sentence. A field caption targets ≤ ~100 characters. If a concept
  needs a paragraph, it needs progressive disclosure (a Docs link, an
  expandable), not a longer caption.
- **Never reference internal documents.** `docs/…` paths, ADR ids, goal
  files, section symbols (§) mean nothing to a reader inside the app and
  leak repository internals. The UI states only the behavior. (Enforced
  for locale files by `scripts/check-ui-copy.sh` — lefthook + CI
  `ui-copy` job.)
- **Never explain by naming other products.** Describe what the feature
  does instead of comparing it to a named competitor. Review-checked,
  not grep-gated (product names are unbounded).
- **No spec-asides.** Em-dash/double-dash clauses that justify the design
  are documentation. State the rule the user experiences; drop the
  defense of it.
- **Present tense, sentence case, second person implied.** "Runs every
  minute", not "This workflow will be run every minute".
- **An empty state offers the action it names.** A sentence telling the
  user to do something, with no affordance beside it to do it, is a dead
  end — ship the button/picker/door in the same view, or change the
  sentence.

The test, mirroring comments.md's: read the string as a first-time user
with no repo access — every clause they couldn't act on is spec
narrative, not copy.
