// Learned categorization memory — the "understands more and more" half of the
// classifier. Every manual classification on /finance/recon teaches a
// counterparty -> category association (fin_category_hints); the classifier
// consults these BEFORE its keyword rules, so a correction like "GET RENTAL
// SDN BHD is equipment, not rent" sticks for every future payment to that
// payee without a code change. Keyword rules stay as the generic fallback.

import { getFinanceClient } from "./supabase";
import type { CashCategory } from "@celsius/db";

export type LearnedHint = {
  phrase: string;
  category: CashCategory;
  direction: "DR" | "CR" | null;
};

// Boilerplate the bank prepends before the counterparty — strip so the
// derived phrase is the payee, not the transfer mechanics.
const PREFIXES = [
  /^TRANSFER (TO|FR) A\/C\s*/,
  /^ELECTRONIC REMITTANCE\s*-?\s*(GIR\w*)?\s*/,
  /^TT (CREDIT|DEBIT)( WITHOUT FLOAT)?\s*/,
  /^(IBG|GIRO|DUITNOW|FPX|JOMPAY)\s*(QR)?-?\s*/,
  /^PAYMENT (TO|FROM)\s*/,
  /^CASH DEPOSIT\s*/,
];

// Words that make a phrase too generic to be a counterparty signature.
const STOPLIST = new Set(["CELSIUS", "COFFEE", "TRANSFER", "PAYMENT", "REMITTANCE", "DEPOSIT", "CREDIT", "DEBIT"]);

// Extract the counterparty signature from a bank description: strip the glued
// 20-char sender prefix and transfer boilerplate, then take the longest run of
// consecutive alphabetic tokens (references and amounts contain digits, so the
// run naturally stops at them). Returns null when nothing distinctive remains.
export function deriveHintPhrase(description: string): string | null {
  let s = (description ?? "").toUpperCase().trim();
  if (!s) return null;
  // Maybank glues a fixed-width 20-char sender name onto the payee.
  if (/^CELSIUS\s?COFFEE/.test(s) && s.length > 20) s = s.slice(20);
  s = s.replace(/\s+/g, " ").trim();
  for (const p of PREFIXES) s = s.replace(p, "");
  s = s.replace(/[.*]/g, "").replace(/\s+/g, " ").trim();

  const tokens = s.split(" ");
  let best: string[] = [];
  let run: string[] = [];
  for (const t of tokens) {
    if (/^[A-Z&'\-]+$/.test(t)) run.push(t);
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  if (run.length > best.length) best = run;

  // Trim entity suffixes off the end so "GET RENTAL SDN BHD" and
  // "GET RENTAL SDN. BHD." derive the same phrase.
  while (best.length && /^(SDN|BHD|SB|ENTERPRISE|ENTERP|TRADING|RESOURCES)$/.test(best[best.length - 1])) best.pop();

  const phrase = best.join(" ").trim();
  if (phrase.length < 6 || best.length < 2) return null;
  if (best.every((w) => STOPLIST.has(w))) return null;
  if (phrase.includes("CELSIUS")) return null; // inter-company, never a vendor signature
  return phrase;
}

export async function fetchLearnedHints(): Promise<LearnedHint[]> {
  const client = getFinanceClient();
  const { data, error } = await client
    .from("fin_category_hints")
    .select("phrase, category, direction");
  if (error) throw new Error(`fin_category_hints read failed: ${error.message}`);
  return (data ?? []) as LearnedHint[];
}

// Called after a user classification: teach the phrase -> category
// association. Last correction wins on conflict (the user just told us).
export async function learnHintsFromLines(
  lines: Array<{ description: string | null; direction: string }>,
  category: CashCategory,
): Promise<number> {
  const client = getFinanceClient();
  const seen = new Map<string, { phrase: string; direction: string }>();
  for (const l of lines) {
    const phrase = deriveHintPhrase(l.description ?? "");
    if (!phrase) continue;
    const prev = seen.get(phrase);
    // Mixed directions for the same phrase -> hint applies to both (null).
    seen.set(phrase, { phrase, direction: prev && prev.direction !== l.direction ? "" : l.direction });
  }
  let learned = 0;
  for (const { phrase, direction } of seen.values()) {
    const { error } = await client.from("fin_category_hints").upsert(
      {
        phrase,
        category,
        direction: direction || null,
        source: "user_correction",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phrase" },
    );
    if (!error) learned += 1;
  }
  return learned;
}
