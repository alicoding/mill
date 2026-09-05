import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The frontend half of atlassvc's own TestAtlasNoHardcodedConcepts
// tripwire (internal/services/atlassvc/atlasservice_nohardcode_test.go)
// -- ADR-0038 Decision 2 requires every card-kind/link-kind NAME to
// live only in a seed file, and that requirement covers frontend/src/
// atlas/** exactly as much as the Go domain package. Same limits as
// the Go version: this only catches the exact seeded example strings
// docs/goals/0061 names, not a general "did someone hardcode a
// concept" analyzer, and a match inside an unrelated string (a comment
// that happens to say "the document says...") would be a false
// positive worth reading before assuming a real violation.
//
// Matched on WORD BOUNDARIES, not as a bare substring: an adopted
// library's own API name legitimately embeds one of these words
// (`parseAllDocuments`, the yaml package's entry point), and failing on
// that would be a tripwire about spelling rather than about a hardcoded
// concept. A concept name standing on its own -- which is the only way
// one ever reaches a user -- still fails.
const SEEDED_CONCEPT_NAMES = ['Topic', 'Contact', 'Document', 'relates to', 'The engagement']

function mentions(content: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(content)
}

const ATLAS_DIR = join(__dirname)

function nonTestSourceFiles(): string[] {
  return readdirSync(ATLAS_DIR)
    .filter((name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
    .map((name) => join(ATLAS_DIR, name))
}

describe('Atlas frontend source carries no hardcoded seeded concept', () => {
  it('never contains a seeded Kind/LinkKind name outside a seed/test file', () => {
    for (const path of nonTestSourceFiles()) {
      const content = readFileSync(path, 'utf-8')
      for (const name of SEEDED_CONCEPT_NAMES) {
        expect(mentions(content, name), `${path} contains seeded concept name "${name}" -- ADR-0038 Decision 2 requires every card-kind/link-kind name to live only in a seed file`).toBe(false)
      }
    }
  })
})
