// The manifest-owned object-face registrations shared by framed and
// same-DOM plugin activation. Kept below the host-door adapter graph so
// the common reload sweep can clear one plugin without importing the
// activation bridge back through itself.

const objectFaces = new Map<string, string>()

function objectFaceKey(pluginId: string, objectKind: string): string {
  return `${pluginId}::${objectKind}`
}

export function registeredCanvasObjectFaceEntry(pluginId: string, objectKind: string): string | undefined {
  return objectFaces.get(objectFaceKey(pluginId, objectKind))
}

export function recordCanvasObjectFace(pluginId: string, objectKind: string, entry: string): void {
  objectFaces.set(objectFaceKey(pluginId, objectKind), entry)
}

export function forgetCanvasObjectFaces(pluginId: string): void {
  for (const key of objectFaces.keys()) {
    if (key.startsWith(`${pluginId}::`)) objectFaces.delete(key)
  }
}
