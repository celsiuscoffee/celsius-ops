// Moved to @celsius/shared (packages/shared/src/loyalty/discount-spec.ts) so
// the POS routes in apps/backoffice can share the exact same spec/cart
// builders as apps/order. Re-exported here for back-compat with existing
// `@/lib/loyalty/discount-spec` importers.
export {
  DISCOUNT_SPEC_COLUMNS,
  rowToDiscountSpec,
  buildEngineCart,
  type DiscountSpecRow,
} from "@celsius/shared";
