// secretTitleFor names an entry created from a field, after the thing
// it belongs to and the field it fills (goal 0306) -- so a store full
// of entries added this way still says what each one is for. Same
// shape the adoption pass uses on the Go side
// (configureservice_secretadoption.go's adoptionTitle).
export function secretTitleFor(entityLabel: string, field: string): string {
  const label = entityLabel.trim()
  const name = field.trim().toLowerCase()
  return label === '' ? name : `${label}: ${name}`
}
