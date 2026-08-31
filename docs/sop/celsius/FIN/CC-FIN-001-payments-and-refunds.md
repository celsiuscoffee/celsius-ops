---
id: CC-FIN-001
title: Payments & Refunds
company: celsius
domain: FIN
tier: policy
owner: Managing Director
status: draft
version: 0.1
effective_date:
review_months: 6
ack_required: true
ack_stations: [foh, lead]
language: en
linked_system_sop:
---

# CC-FIN-001 — Payments & Refunds

## 1. Purpose

Celsius Coffee is a **cashless business**. This policy fixes the rules for how
money comes in (which payment methods, how a payment is confirmed) and how it
goes back out (who may refund, how much, and how it is recorded), so that
every ringgit rung up can be traced to a ringgit that lands in the bank.

## 2. Scope

All sales channels of Celsius Coffee: counter POS (SUNMI registers), the
Celsius Coffee customer app (pickup + dine-in QR), online ordering, GrabFood,
and GastroHub consignment. Applies to all staff who take payments or handle
refund requests. Not covered: petty cash and staff expense claims (bank-side
processes, separate documents); payroll.

## 3. Definitions

| Term | Meaning |
|---|---|
| Cashless | No physical cash is accepted or kept at any outlet — no drawer, no float |
| Settlement | Money from a payment channel actually arriving in the company bank account |
| Z-Report | The per-shift sales report, derived from the shift's completed orders |
| Recovery voucher | A goodwill voucher issued through the complaint process (CC-OPS-001), not a refund |

## 4. Roles & responsibilities

| Role | Responsibility |
|---|---|
| Cashier / barista (FOH) | Take payment only via approved methods; verify before confirming; never accept cash |
| Outlet manager | Open/close the store in POS; authorise elevated actions with manager PIN; handle refund requests |
| Managing Director | Approves any refund; owns changes to accepted payment methods |
| Finance (weekly settlement check) | Investigate settlement variances flagged by the reconciliation agent |

## 5. Policy

### 5.1 Accepted payment methods

1. **Counter (POS):** DuitNow QR (primary) and card on the Maybank terminal.
   **Cash is not accepted.** If a customer has only cash, a colleague or
   manager may pay by QR on the customer's behalf and take the cash
   personally — the company itself never holds cash takings.
2. **Celsius app / online ordering:** the in-app payment gateway and app
   wallet/vouchers only.
3. **Delivery / consignment:** GrabFood and GastroHub collect from the
   customer and settle to the company under their commission terms.
4. No other payment method (personal transfer to a staff account, "pay next
   time", IOU) is ever accepted. Adding or removing a payment method is a
   Managing Director decision and a revision of this policy.

### 5.2 Confirming a QR payment

5. DuitNow QR has **no automatic callback**: the cashier must **see the
   payment land** (Maybank notification/app) before tapping *Payment
   Received* on the POS. Tapping it unverified is a disciplinary matter —
   it books revenue that may not exist.
6. If confirmation cannot be seen (network, app down), do not release the
   order; ask the customer to show their payment success screen AND note the
   order for the manager to verify against the bank the same day.

### 5.3 Store open/close discipline

7. No sale is rung up outside an open store session: **Open Store** at the
   start of service, **Close Store** at the end. The Z-Report totals derive
   from the session's orders.
8. An accidental early close is fixed by **Resume last shift** (available for
   6 hours), never by opening a second session for the same service day.

### 5.4 Refunds

9. There is **no refund button on the POS**. A refund is always a manager
   decision, executed as a bank transfer by the Managing Director (or a
   role the MD delegates in writing), recorded as `CUSTOMER_REFUND` in
   finance with the order reference and reason.
10. First remedy is always **remake or replace on the spot** (free — see
    CC-OPS-001); second is a recovery voucher. A money refund is the last
    resort, appropriate when the customer paid for something we could not
    deliver (e.g. paid online, order failed).
11. A refund **demand** attached to a threat (review, legal, health claim)
    is an escalation case under CC-OPS-001 §5.4 — frontline staff never
    negotiate it.
12. Any elevated POS action (void, price override) requires a manager PIN
    (OWNER/ADMIN/MANAGER). PINs are personal; lending a manager PIN to
    staff is prohibited.

### 5.5 Settlement expectations

13. Money rung up must land in the bank within the channel's normal terms.
    Approximate expected deductions, used by the weekly automated
    settlement check: QR ≈ 0% (real-time), card ≈ 1%, online gateway ≈ 2%,
    GrabFood ≈ 45% all-in, GastroHub ≈ 30%.
14. The reconciliation agent's weekly digest is advisory: every flagged
    variance ("money rung that has not arrived") must be investigated and
    the outcome noted, within one week of the digest.
15. Staff who notice any payment anomaly (double charge, unconfirmed QR,
    terminal error) report it to the outlet manager the **same day**.

## 6. Records

| Record | Where | Retention |
|---|---|---|
| Shift sessions & Z-Reports | POS `pos_shifts` + backoffice Z-Report | Permanent |
| Daily sales journals | Finance module (EOD ingest, 4 AM) | Permanent |
| Settlement variance flags | Finance agent decisions log + Telegram digest | Permanent |
| Refunds | Bank transaction classified `CUSTOMER_REFUND` + reason note | 7 years |

## 7. References

- CC-OPS-001 Incident & Complaint Handling (remedies, escalation, recovery vouchers)
- CC-GOV-002 Roles & Authority Matrix (planned — approval limits)
- `docs/finance-module-spec.md` — finance module & reconciliation detail

## 8. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-08-31 | Drafted in agent session for MD review | First draft |
