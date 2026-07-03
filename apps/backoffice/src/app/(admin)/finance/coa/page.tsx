"use client";

// Chart of Accounts — the one place to see and grow the COA (seeded from
// Bukku, owned in-house since 2026-05). Create an account when a category
// needs a new home; deactivate what is no longer used. Below it, the learned
// categorizations: every manual classification on the Reconciliation page
// teaches the classifier a payee -> category association shown here.

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Button } from "@celsius/ui";
import { Loader2, Plus } from "lucide-react";

type Account = {
  code: string; name: string; type: string; subtype: string | null;
  parent_code: string | null; outlet_specific: boolean; is_active: boolean;
};
type Hint = { phrase: string; category: string; direction: string | null; source: string; hits: number; updated_at: string };

const TYPE_ORDER = ["asset", "liability", "equity", "income", "cogs", "expense"] as const;
const TYPE_LABEL: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity",
  income: "Income", cogs: "Cost of Sales", expense: "Expenses",
};

export default function CoaPage() {
  const { data, mutate } = useFetch<{ accounts: Account[] }>("/api/finance/accounts?all=true");
  const { data: hintData, mutate: mutateHints } = useFetch<{ hints: Hint[] }>("/api/finance/category-hints");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ code: "", name: "", type: "expense", parentCode: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];
  const t = q.trim().toLowerCase();
  const filtered = t
    ? accounts.filter((a) => a.code.toLowerCase().includes(t) || a.name.toLowerCase().includes(t))
    : accounts;

  async function createAccount() {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/finance/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, parentCode: form.parentCode || undefined }),
      });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
      else {
        setNote(`Created ${form.code} ${form.name}.`);
        setForm({ code: "", name: "", type: form.type, parentCode: "" });
        mutate();
      }
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function toggleActive(a: Account) {
    await fetch("/api/finance/accounts", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: a.code, isActive: !a.is_active }),
    });
    mutate();
  }

  async function forgetHint(phrase: string) {
    await fetch("/api/finance/category-hints", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    mutateHints();
  }

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <header>
        <h1 className="text-xl sm:text-2xl font-semibold">Chart of Accounts</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
          Seeded from Bukku, owned here. Bank categories book to these accounts; add one when a spend type needs its own line.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} placeholder="6515-01"
              className="mt-1 block h-8 w-28 rounded border border-gray-200 px-2 text-sm tabular-nums" />
          </label>
          <label className="text-xs text-gray-500">Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Equipment rental"
              className="mt-1 block h-8 w-56 rounded border border-gray-200 px-2 text-sm" />
          </label>
          <label className="text-xs text-gray-500">Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 block h-8 rounded border border-gray-200 bg-white px-2 text-sm">
              {TYPE_ORDER.map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Parent (optional)
            <input value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value.trim() })} placeholder="6515"
              className="mt-1 block h-8 w-24 rounded border border-gray-200 px-2 text-sm tabular-nums" />
          </label>
          <Button size="sm" onClick={createAccount} disabled={busy || !form.code || !form.name}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add account
          </Button>
        </div>
        {note && <p className="mt-2 text-[11px] text-gray-500">{note}</p>}
      </section>

      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name…"
          className="h-8 w-64 rounded border border-gray-200 bg-white px-2 text-sm" />
        <span className="text-[11px] text-gray-400 tabular-nums">{filtered.length} of {accounts.length} accounts</span>
      </div>

      {!data ? <div className="py-12 text-center text-sm text-gray-400">Loading…</div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {TYPE_ORDER.map((type) => {
            const rows = filtered.filter((a) => a.type === type);
            if (!rows.length) return null;
            return (
              <section key={type} className="overflow-hidden rounded-lg border bg-white">
                <header className="border-b bg-gray-50/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {TYPE_LABEL[type]} <span className="font-normal">· {rows.length}</span>
                </header>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {rows.map((a) => (
                      <tr key={a.code} className={a.is_active ? "" : "opacity-45"}>
                        <td className="w-24 whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 tabular-nums"
                          style={{ paddingLeft: a.parent_code ? 28 : 12 }}>{a.code}</td>
                        <td className="px-3 py-1.5">{a.name}</td>
                        <td className="w-24 px-3 py-1.5 text-right">
                          <button onClick={() => toggleActive(a)} className="text-[11px] text-gray-400 underline hover:text-gray-600">
                            {a.is_active ? "deactivate" : "reactivate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Learned categorizations</h2>
          <span className="text-[11px] text-gray-400">taught by your manual classifications on the Reconciliation page</span>
        </div>
        {!hintData ? <div className="py-6 text-center text-sm text-gray-400">Loading…</div>
        : hintData.hints.length === 0 ? (
          <p className="rounded-lg border bg-white px-4 py-3 text-xs text-gray-400">
            Nothing learned yet. Classify a line on the Reconciliation page and its payee shows up here; future payments to that payee classify themselves.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b bg-gray-50/60 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Payee phrase</th>
                <th className="px-3 py-2 font-medium">Books to</th>
                <th className="px-3 py-2 font-medium">Direction</th>
                <th className="px-3 py-2 font-medium">Learned</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y">
                {hintData.hints.map((h) => (
                  <tr key={h.phrase}>
                    <td className="px-3 py-1.5 font-medium">{h.phrase}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{h.category.toLowerCase().replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">{h.direction === "DR" ? "cash out" : h.direction === "CR" ? "cash in" : "both"}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-400 tabular-nums">{h.updated_at.slice(0, 10)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => forgetHint(h.phrase)} className="text-[11px] text-gray-400 underline hover:text-gray-600">forget</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
