// Best-effort audit trail for manual bank line changes (fin_bank_line_events).
// Every classify / match / unmatch / reject-match records who did what with
// the old and new values, so the recon page can show a per-line history.
// Writing the trail must never break the main operation: this helper swallows
// and logs failures (including the table not existing before migration 071
// is applied).

import { getFinanceClient } from "./supabase";

export type BankLineEventInput = {
  lineId: string;
  event: "classify" | "match" | "unmatch" | "reject_match";
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
};

export async function logBankLineEvents(
  events: BankLineEventInput[],
  actor: string | null | undefined,
): Promise<void> {
  if (!events.length) return;
  try {
    const client = getFinanceClient();
    const rows = events.map((e) => ({
      line_id: e.lineId,
      event: e.event,
      old_value: e.oldValue ?? null,
      new_value: e.newValue ?? null,
      actor: actor || "system",
    }));
    const { error } = await client.from("fin_bank_line_events").insert(rows);
    if (error) console.error("[bank-line-events] insert failed:", error.message);
  } catch (e) {
    console.error("[bank-line-events] insert failed:", e instanceof Error ? e.message : e);
  }
}
