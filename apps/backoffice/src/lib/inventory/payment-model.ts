// Supplier payment-model classifier.
//
// The 17 supplier-chat analysis found automation must branch on three payment
// models (docs/design/procurement-chat-learnings.md, pattern 3):
//   - prepay-before-delivery (HNJ, RICH's, Xora, BeansCo, Farm Fresh) — the POP
//     is delivery-critical: they load the lorry only after "clear payment first".
//   - monthly credit + SOA batch settlement (GCR, BBM 14-day, Yow Seng).
//   - deposit + balance (Collective 50/50) — two POPs per order.
//
// Derived deterministically from the fields we already store (depositPercent +
// free-text paymentTerms) so the supplier-chat agent and the inbox can flag a
// payment message as urgent for prepay suppliers, and so a deposit supplier is
// understood to need two receipts. Pure + unit-tested.

export type PaymentModel = "prepay" | "deposit_balance" | "credit_soa" | "standard";

export type PaymentModelInfo = {
  model: PaymentModel;
  label: string;
  note: string;
  // True when a payment must clear BEFORE the supplier releases goods — the POP
  // is on the critical path, so a payment query from this supplier is urgent.
  popDeliveryCritical: boolean;
};

const PREPAY_RX =
  /\b(pre-?pay|prepaid|upfront|pay\s*(?:first|before|upfront|in\s*advance)|clear\s*payment\s*first|before\s*delivery|cash\s*before|advance\s*payment|c\.?o\.?d\.?|cash\s*on\s*delivery)\b/i;
const CREDIT_RX =
  /\b(net\s*\d+|\d+\s*[- ]?days?|credit|monthly|month\s*end|soa|statement\s*of\s*account|invoice\s*\d+\s*days?)\b/i;

/**
 * Classify a supplier's payment model from its deposit policy + terms text.
 * Deposit policy wins (it's structured); otherwise the free-text terms are
 * matched, defaulting to "standard" (pay on/around delivery) when unknown.
 */
export function paymentModel(input: {
  paymentTerms?: string | null;
  depositPercent?: number | null;
}): PaymentModelInfo {
  const deposit = input.depositPercent ?? 0;
  if (deposit > 0 && deposit < 100) {
    return {
      model: "deposit_balance",
      label: `Deposit ${deposit}% + balance`,
      note: "Deposit upfront, balance on/after delivery — expect two POPs per order.",
      popDeliveryCritical: true,
    };
  }

  const terms = (input.paymentTerms ?? "").trim();
  if (terms && PREPAY_RX.test(terms)) {
    return {
      model: "prepay",
      label: "Prepay before delivery",
      note: "Pay before they release the goods — the POP is delivery-critical.",
      popDeliveryCritical: true,
    };
  }
  if (terms && CREDIT_RX.test(terms)) {
    return {
      model: "credit_soa",
      label: "Credit / SOA settlement",
      note: "On credit — settle by statement of account in a batch.",
      popDeliveryCritical: false,
    };
  }
  return {
    model: "standard",
    label: "Standard terms",
    note: "Pay on delivery / standard terms.",
    popDeliveryCritical: false,
  };
}
