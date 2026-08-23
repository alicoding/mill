// The createObjectURL + <a download> download mechanism (promoted out
// of views/DataStewardshipSection.tsx, goal 0133 slice E1's Export-as
// menu, once atlas/'s per-card exporters became a second consumer --
// frontend.md's shared/-promotion rule). A caller that already has a
// Blob passes it directly; a caller holding raw BlobPart bytes and a
// MIME type constructs one first.
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
