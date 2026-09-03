// The grid's render-side view of a List (goal 0136): what any grid
// implementation takes -- the Atlas projections and Configure's List
// page both map a List record onto these and mount the same grid.
export interface GridColumn {
  Key: string
  Label: string
  Type?: string
  Options: string[] | null
  OptionColors: string[] | null
  Deprecated?: boolean
}

export interface GridRow {
  ID: string
  Status: string
  Values: { [key: string]: string | undefined } | null
}
