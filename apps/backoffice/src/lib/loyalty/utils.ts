// Format helpers live in @celsius/shared (single source of truth). These
// bodies used to be copy-pasted here and could drift from the canonical
// versions; re-export instead, matching apps/loyalty/src/lib/utils.ts.
export {
  formatPoints,
  formatCurrency,
  formatPhone,
  toStoragePhone,
  toLocalPhone,
  generateRedemptionCode,
  getProgressPercentage,
  getTimeAgo,
} from "@celsius/shared";
