import { useEffect, useState } from 'react'
import { Button, Heading, Label, Stack, Text, Token } from '@primer/react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import type { NodeType, Recipe } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from './RunbookView.module.css'

const KIND_VARIANT: Record<string, 'accent' | 'success' | 'severe'> = {
  capture: 'accent',
  process: 'success',
  apply: 'severe',
}

// A prototype for SPEC.md §3 / ADR-0005 (config-first, canvas deferred):
// node types and recipes render as plain lists/chip-chains, not a
// canvas/graph library -- deliberately, to test that call visually
// instead of only asserting it in prose. Recipes here are the same real
// clipboard/markdown capability internal/domain/runbook already ships,
// decomposed into reusable node primitives -- internal/domain/runbook
// itself is untouched; hitting Run below executes the real capability
// through the new composed path, side by side with the Runbook page.
function CompositionView() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[] | null>(null)
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    CompositionService.NodeTypes().then((list) => setNodeTypes(list ?? [])).catch(console.error)
    CompositionService.Recipes().then((list) => setRecipes(list ?? [])).catch(console.error)
  }, [])

  const nodeById = (id: string) => nodeTypes?.find((n) => n.ID === id)

  const run = (id: string) => {
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    CompositionService.RunRecipe(id)
      .then((output) => setResults((prev) => ({ ...prev, [id]: output })))
      .catch((err) => setErrors((prev) => ({ ...prev, [id]: String(err) })))
      .finally(() => setRunningId(null))
  }

  return (
    <div className={styles.runbook} data-testid="composition-view">
      <Heading as="h1">Capability composition</Heading>
      <Text as="p" className={styles.subtitle}>
        Prototype for docs/SPEC.md §3 (ADR-0005): node primitives and the
        recipes composed from them, rendered as plain lists — not a
        canvas — since a canvas isn&apos;t earned yet. Recipes here run
        the real clipboard/markdown capability, decomposed into reusable
        steps; internal/domain/runbook (the Runbook page) is untouched.
      </Text>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>
        Node primitives
      </Heading>
      {nodeTypes === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {nodeTypes !== null && (
        <Stack direction="vertical" gap="condensed">
          {nodeTypes.map((node) => (
            <div key={node.ID} className={styles.card} data-testid="node-type-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Text weight="semibold">{node.Label}</Text>
                  <Text as="p" size="small" className={styles.muted}>{node.Description}</Text>
                </div>
                <Label variant={KIND_VARIANT[node.Kind] ?? 'secondary'} size="small">{node.Kind}</Label>
              </Stack>
            </div>
          ))}
        </Stack>
      )}

      <Heading as="h2" variant="small" className={styles.sectionHeading}>
        Recipes
      </Heading>
      {recipes === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {recipes !== null && (
        <Stack direction="vertical" gap="condensed">
          {recipes.map((recipe) => (
            <div key={recipe.ID} className={styles.card} data-testid="recipe-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Text weight="semibold">{recipe.Label}</Text>
                  <Text as="p" size="small" className={styles.muted}>{recipe.Description}</Text>
                </div>
                <Button onClick={() => run(recipe.ID)} disabled={runningId === recipe.ID} size="small">
                  {runningId === recipe.ID ? 'Running…' : 'Run'}
                </Button>
              </Stack>

              <Stack direction="horizontal" align="center" gap="condensed" className={styles.recipeChain}>
                {(recipe.NodeIDs ?? []).map((nodeId, i) => (
                  <Stack key={nodeId} direction="horizontal" align="center" gap="condensed">
                    {i > 0 && <Text className={styles.muted}>→</Text>}
                    <Token text={nodeById(nodeId)?.Label ?? nodeId} size="large" />
                  </Stack>
                ))}
              </Stack>

              {errors[recipe.ID] && (
                <Text as="p" size="small" className={styles.error}>{errors[recipe.ID]}</Text>
              )}
              {results[recipe.ID] !== undefined && !errors[recipe.ID] && (
                <pre className={styles.result}>{results[recipe.ID]}</pre>
              )}
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}

export default CompositionView
