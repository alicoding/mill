import { Category } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'

// docs/adr/0027: Category is required (and immutable once created), so
// a Decision's quick-create needs one more field than request/mcpserver's
// label+secondary shape -- still deliberately minimal (no Outputs/
// webhook here; Configure > Decisions is the canonical place to add
// those afterward, same "quick-create produces a usable starting point,
// Configure refines it" split every other kind here already has).
export function decisionCategoryLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [Category.CategoryApprove]: t('entityRefField.decisionCategoryLabel.approve'),
    [Category.CategoryDeny]: t('entityRefField.decisionCategoryLabel.deny'),
    [Category.CategoryManualReview]: t('entityRefField.decisionCategoryLabel.manualReview'),
    [Category.CategoryActionNeeded]: t('entityRefField.decisionCategoryLabel.actionNeeded'),
    [Category.CategoryUncategorized]: t('entityRefField.decisionCategoryLabel.uncategorized'),
  }
}
