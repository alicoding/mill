import { expect, type Locator, type Page } from '@playwright/test'
import { fillCodeEditor } from './codeEditor'

// The step-test door as an e2e fixture (ADR-0051 §5): drive the
// selected step's "Try this step" section in the given inspector panel
// with one input and return the section, so a step spec asserts on the
// real output (or the refusal) the same way a user reads it. Promoted
// from the converter-only Try it (step-io-contract.spec.ts) once every
// step gained the surface.
export async function tryStep(page: Page, panel: Locator, input: string): Promise<Locator> {
	const section = panel.getByTestId('step-test-section')
	await expect(section).toBeVisible()
	await fillCodeEditor(page, 'step-test-input', input)
	await section.getByTestId('step-test-run').click()
	return section
}

// stepOutput waits for the step's output editor and returns it.
export async function stepOutput(section: Locator): Promise<Locator> {
	const output = section.getByTestId('step-test-output')
	await expect(output).toBeVisible()
	return output
}
