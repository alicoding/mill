import type { OutputShape } from './outputShape'

// A step's declared produce kind, as an output shape (goal 0326).
//
// The producer already declares this: ADR-0042's step I/O contract
// (NodeType.Produces) names the coarse media kind that leaves a step,
// machine-checked at registration and enforced at draw time. No second
// per-step fact was added for the viewer -- it reads the one that
// exists, which is what keeps the canvas's edge compatibility and the
// output surface from ever disagreeing.
//
// Two declarations answer "nothing useful", and both fall through to
// the viewer's structural inference rather than a wrong claim:
//   `any`  -- a script's stdout, an MCP tool's result: the step itself
//             promises nothing.
//   passthrough -- the effective kind is the UPSTREAM step's, which
//             this call has no graph to resolve.
export function shapeForPayloadKind(kind: string | undefined, passthrough?: boolean): OutputShape | undefined {
  if (passthrough) return undefined
  switch (kind) {
    case 'json':
      return 'json'
    case 'html':
      return 'html'
    case 'markdown':
      return 'markdown'
    case 'text':
      return 'text'
    default:
      return undefined
  }
}

// The same answer from a node-type list, for a surface holding a step's
// node-type id rather than the type itself.
export function shapeForNodeType(
  nodeTypes: { ID: string; Produces?: { kind?: string; passthrough?: boolean } }[] | null | undefined,
  nodeTypeID: string,
): OutputShape | undefined {
  const produces = nodeTypes?.find((n) => n.ID === nodeTypeID)?.Produces
  return shapeForPayloadKind(produces?.kind, produces?.passthrough)
}

// The response's own declared type, read case-insensitively (a header
// name is case-insensitive by the HTTP spec, and a map keyed by the
// wire's own casing is what the bound call hands back). Fed to the
// viewer's `mime`, which is the converged rule for picking a response
// view: the producer said what it sent.
export function contentTypeOf(headers: { [key: string]: string | undefined } | null | undefined): string | undefined {
  if (!headers) return undefined
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') return value
  }
  return undefined
}
