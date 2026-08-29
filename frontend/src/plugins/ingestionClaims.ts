import type { CanvasObjectContribution } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// ingestionClaimMismatch enforces the claim/source pairing
// (docs/goals/0251): an ingestion claim's payload shape derives from
// the object's declared source (fileExtensions land mirrorPath on a
// file-backed object; pastesURLs lands url on a url-backed one), so a
// mismatched pairing would route content into a payload key the
// object never reads. Failing the LOAD with a stated reason keeps the
// claim from being silently dead. Its own module (type-only bindings
// import) so the unit test never evaluates the runtime-bound host API.
export function ingestionClaimMismatch(contribution: CanvasObjectContribution | undefined, source: 'board-local' | 'url' | 'file'): string | null {
	if (!contribution) return null
	if ((contribution.fileExtensions?.length ?? 0) > 0 && source !== 'file') {
		return `the manifest claims file extensions for "${contribution.kind}", so its source must be "file"`
	}
	if (contribution.pastesURLs && source !== 'url') {
		return `the manifest claims pasted links for "${contribution.kind}", so its source must be "url"`
	}
	return null
}
