"use client";

// Journals view for /finance/transactions: the posted fin_transactions ledger
// (double-entry journals from the agents), plus the manual journal entry
// screen (the QuickBooks/Xero adjusting-entry flow) and reversal. Owner/Admin
// only, matching the API gates.

import { useEffect, useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, Badge, Button, toast, useConfirm,
} from "@celsius/ui";
import { Loader2, Plus, Search, Trash2, Undo2 } from "lucide-react";

const RM = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

type Company = { id: string; name: string; isDefault: boolean; isActive: boolean; outletIds: string[] };
type Account = { code: string; name: string; type: string; is_active: boolean };
type Outlet = { id: string; name: string; code: string; status?: string };

type Txn = {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  txn_type: string;
  posted_by_agent: string | null;
  agent_version: string | null;
  status: string;
  posted_at: string | null;
  period: string;
  company_id: string;
  accounts: string[];
  outlet: { id: string; name: string; code: string } | null;
};

type TxnDetail = {
  transaction: {
    id: string; txn_date: string; description: string; amount: number; txn_type: string;
    posted_by_agent: string | null; agent_version: string | null; status: string;
    posted_at: string | null; period: string; company_id: string; outlet_id: string | null;
    reversed_by_id: string | null;
  };
  lines: {
    id: string; account_code: string; account_name: string | null; outlet_id: string | null;
    debit: number; credit: number; memo: string | null; line_order: number;
  }[];
};

function agentLabel(agent: string | null): string {
  if (!agent) return "System";
  if (agent === "manual") return "Manual";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "posted" ? "border-green-600/40 text-green-700"
    : status === "reversed" ? "border-amber-600/40 text-amber-700"
    : status === "exception" ? "border-red-600/40 text-red-700"
    : "text-muted-foreground";
  return <Badge variant="outline" className={`font-normal capitalize ${cls}`}>{status}</Badge>;
}

const SELECT_CLASS = "h-8 rounded-md border bg-background px-2 text-xs sm:text-sm shrink-0 max-w-[40vw]";

const TYPE_ORDER = ["asset", "liability", "equity", "income", "cogs", "expense"] as const;
const TYPE_LABEL: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity",
  income: "Income", cogs: "Cost of sales", expense: "Expenses",
};

// Searchable account combobox: type a code or name fragment, pick from the
// dropdown (grouped by account type). Options come from /api/finance/accounts.
function AccountPicker({ accounts, value, onChange }: {
  accounts: Account[];
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = useMemo(() => accounts.find((a) => a.code === value) ?? null, [accounts, value]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t
      ? accounts.filter((a) => a.code.toLowerCase().includes(t) || a.name.toLowerCase().includes(t))
      : accounts;
  }, [accounts, q]);

  const groups = useMemo(() => {
    const by = new Map<string, Account[]>();
    for (const a of filtered) {
      const arr = by.get(a.type) ?? [];
      arr.push(a);
      by.set(a.type, arr);
    }
    return TYPE_ORDER.filter((t) => by.has(t)).map((t) => ({ type: t, accounts: by.get(t)! }));
  }, [filtered]);

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={open ? q : selected ? `${selected.code} ${selected.name}` : ""}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        onBlur={() => setOpen(false)}
        placeholder="Search account by code or name"
        className="h-8 w-full rounded-md border bg-background px-2 text-xs sm:text-sm"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border bg-card shadow-lg">
          {groups.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">No matching accounts.</p>
          )}
          {groups.map((g) => (
            <div key={g.type}>
              <p className="sticky top-0 bg-muted/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {TYPE_LABEL[g.type] ?? g.type}
              </p>
              {g.accounts.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(a.code); setOpen(false); }}
                  className={`block w-full px-2 py-1.5 text-left text-xs hover:bg-muted/40 ${a.code === value ? "bg-muted/30 font-medium" : ""}`}
                >
                  <span className="font-mono tabular-nums">{a.code}</span> {a.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type FormLine = { key: number; accountCode: string; debit: string; credit: string; outletId: string };

let lineKey = 0;
const newLine = (): FormLine => ({ key: ++lineKey, accountCode: "", debit: "", credit: "", outletId: "" });

const cents = (n: number) => Math.round(n * 100);
const lineAmount = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// The manual journal entry drawer: company, date, memo and dynamic debit/credit
// rows with a running balance footer. Post is enabled only when balanced.
function NewJournalSheet({ open, onOpenChange, companies, defaultCompanyId, accounts, outlets, onPosted }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: Company[];
  defaultCompanyId: string;
  accounts: Account[];
  outlets: Outlet[];
  onPosted: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<FormLine[]>([newLine(), newLine()]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (defaultCompanyId) setCompanyId((c) => c || defaultCompanyId); }, [defaultCompanyId]);

  const company = companies.find((c) => c.id === companyId);
  const outletOptions = useMemo(() => {
    if (!company || company.outletIds.length === 0) return outlets;
    const ids = new Set(company.outletIds);
    return outlets.filter((o) => ids.has(o.id));
  }, [company, outlets]);

  function patchLine(key: number, patch: Partial<FormLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.reduce((s, l) => s + lineAmount(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + lineAmount(l.credit), 0);
  const diff = (cents(totalDebit) - cents(totalCredit)) / 100;
  const balanced = cents(totalDebit) === cents(totalCredit) && cents(totalDebit) > 0;

  const linesValid = lines.every((l) => {
    const d = lineAmount(l.debit);
    const c = lineAmount(l.credit);
    return l.accountCode && (d > 0) !== (c > 0);
  });
  const canPost = !!companyId && !!date && memo.trim().length > 0 && lines.length >= 2 && linesValid && balanced;

  function reset() {
    setDate(today);
    setMemo("");
    setLines([newLine(), newLine()]);
    setError(null);
  }

  async function post() {
    if (!canPost || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          date,
          memo: memo.trim(),
          lines: lines.map((l) => ({
            accountCode: l.accountCode,
            debit: lineAmount(l.debit),
            credit: lineAmount(l.credit),
            outletId: l.outletId || null,
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      toast.success(`Journal posted (ref ${String(j.reference).slice(0, 8)})`);
      reset();
      onOpenChange(false);
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>New manual journal</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Company</span>
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${SELECT_CLASS} w-full max-w-none`}>
                {companies.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs sm:text-sm" />
            </label>
            <label className="space-y-1 sm:col-span-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Memo</span>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this adjustment for?"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs sm:text-sm" />
            </label>
          </div>

          <div className="rounded-lg border">
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_2rem] gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span>Outlet</span><span />
            </div>
            <div className="divide-y">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_2rem] sm:items-center">
                  <div className="col-span-2 sm:col-span-1">
                    <AccountPicker accounts={accounts} value={l.accountCode} onChange={(code) => patchLine(l.key, { accountCode: code })} />
                  </div>
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal" placeholder="Debit"
                    value={l.debit}
                    onChange={(e) => patchLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs tabular-nums sm:text-sm"
                  />
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal" placeholder="Credit"
                    value={l.credit}
                    onChange={(e) => patchLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs tabular-nums sm:text-sm"
                  />
                  <select value={l.outletId} onChange={(e) => patchLine(l.key, { outletId: e.target.value })}
                    className="h-8 w-full rounded-md border bg-background px-1 text-xs" title="Outlet (optional)">
                    <option value="">No outlet</option>
                    {outletOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    disabled={lines.length <= 2}
                    className="justify-self-end text-muted-foreground hover:text-destructive disabled:opacity-30"
                    title={lines.length <= 2 ? "A journal needs at least 2 lines" : "Remove line"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t px-3 py-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus className="mr-1 h-3 w-3" /> Add line
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-6 py-3 text-xs tabular-nums">
          <span>Debits <span className="font-semibold">{RM(totalDebit)}</span></span>
          <span>Credits <span className="font-semibold">{RM(totalCredit)}</span></span>
          {cents(totalDebit) === 0 && cents(totalCredit) === 0 ? (
            <span className="text-muted-foreground">Enter amounts to balance</span>
          ) : (
            <span className={balanced ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
              {balanced ? "Balanced" : `Out of balance ${RM(Math.abs(diff))}`}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={posting}>Cancel</Button>
            <Button size="sm" onClick={post} disabled={!canPost || posting}>
              {posting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Post journal
            </Button>
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function JournalsPanel() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { data: me } = useFetch<{ role: string }>("/api/auth/me");
  const canPost = !!me && ["OWNER", "ADMIN"].includes(me.role);

  const { data: companyData } = useFetch<{ companies: Company[]; activeCompanyId: string }>("/api/finance/companies");
  const companies = useMemo(() => companyData?.companies ?? [], [companyData]);
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    if (!companyId && companyData?.activeCompanyId) setCompanyId(companyData.activeCompanyId);
  }, [companyData, companyId]);

  const { data: acctData } = useFetch<{ accounts: Account[] }>("/api/finance/accounts");
  const accounts = useMemo(() => acctData?.accounts ?? [], [acctData]);
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.code, a.name])), [accounts]);

  const { data: outletData } = useFetch<Outlet[]>("/api/settings/outlets");
  const outlets = useMemo(() => (Array.isArray(outletData) ? outletData : []), [outletData]);

  const { data, error, isLoading, mutate } = useFetch<{ transactions: Txn[] }>(
    companyId ? `/api/finance/transactions?companyId=${encodeURIComponent(companyId)}` : null
  );
  const txns = useMemo(() => data?.transactions ?? [], [data]);

  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [sourceF, setSourceF] = useState("");

  const sourceOptions = useMemo(
    () => Array.from(new Set(txns.map((t) => t.posted_by_agent ?? ""))).sort(),
    [txns]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return txns.filter((t) => {
      if (statusF && t.status !== statusF) return false;
      if (sourceF && (t.posted_by_agent ?? "") !== sourceF) return false;
      if (s) {
        const hay = `${t.description} ${t.id} ${t.txn_type} ${t.accounts.join(" ")} ${t.outlet?.name ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [txns, search, statusF, sourceF]);

  const MAX_RENDER = 300;
  const rendered = filtered.slice(0, MAX_RENDER);

  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail, mutate: mutateDetail } = useFetch<TxnDetail>(
    openId ? `/api/finance/transactions/${openId}` : null
  );
  const [reversing, setReversing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  async function reverseOpen() {
    if (!openId || reversing) return;
    const ok = await confirm({
      title: "Reverse this journal?",
      description: "Posts a mirror journal dated today (debits and credits swapped) and marks this one as reversed. This cannot be undone.",
      confirmLabel: "Reverse journal",
      destructive: true,
    });
    if (!ok) return;
    setReversing(true);
    try {
      const res = await fetch("/api/finance/journal-entries/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: openId }),
      });
      const j = await res.json();
      if (!res.ok) toast.error(j.error ?? `Failed (${res.status})`);
      else {
        toast.success(`Reversed. Counter-journal ref ${String(j.reference).slice(0, 8)}.`);
        mutate();
        mutateDetail();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setReversing(false);
    }
  }

  const detailTotals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of detail?.lines ?? []) { d += Number(l.debit); c += Number(l.credit); }
    return { d, c };
  }, [detail]);

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, account, reference"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm"
            />
          </div>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={SELECT_CLASS} title="Company">
            {companies.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={SELECT_CLASS} title="Status">
            <option value="">All statuses</option>
            <option value="posted">Posted</option>
            <option value="reversed">Reversed</option>
            <option value="draft">Draft</option>
            <option value="exception">Exception</option>
          </select>
          <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} className={SELECT_CLASS} title="Source">
            <option value="">All sources</option>
            {sourceOptions.map((a) => (
              <option key={a || "__none__"} value={a}>{a ? agentLabel(a) : "System"}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground tabular-nums">{filtered.length} journals</span>
          {canPost && (
            <Button size="sm" className="ml-auto h-8" onClick={() => setNewOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New journal
            </Button>
          )}
        </div>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load: {String(error)}
        </div>
      )}

      {data && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No journals match. Post one with New journal, or switch company.
        </div>
      )}

      {data && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="hidden whitespace-nowrap px-3 py-2 font-medium sm:table-cell">Source</th>
                <th className="hidden whitespace-nowrap px-3 py-2 font-medium md:table-cell">Status</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rendered.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t transition hover:bg-muted/30" onClick={() => setOpenId(t.id)}>
                  <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{t.txn_date}</td>
                  <td className="max-w-[340px] px-3 py-2">
                    <div className="truncate">{t.description}</div>
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="capitalize">{t.txn_type.replace(/_/g, " ")}</span>
                      {t.outlet && <span>· {t.outlet.name}</span>}
                      <span className="sm:hidden">· {agentLabel(t.posted_by_agent)}</span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 align-top sm:table-cell">
                    <Badge variant="outline" className={`font-normal ${t.posted_by_agent === "manual" ? "border-blue-600/40 text-blue-700" : "text-muted-foreground"}`}>
                      {agentLabel(t.posted_by_agent)}
                    </Badge>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 align-top md:table-cell">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top font-medium tabular-nums">
                    {RM(Number(t.amount))}
                  </td>
                </tr>
              ))}
              {filtered.length > MAX_RENDER && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-xs text-muted-foreground">
                    Showing first {MAX_RENDER} of {filtered.length.toLocaleString()} journals. Narrow with search or filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Journal detail drawer */}
      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Journal</SheetTitle>
          </SheetHeader>
          {!detail ? (
            <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="flex-1 space-y-5 overflow-y-auto p-6 text-sm">
              <section className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
                <div className="break-words">{detail.transaction.description}</div>
                <div className="break-all text-xs text-muted-foreground">Ref: {detail.transaction.id}</div>
              </section>
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Date</div>
                  <div className="tabular-nums">{detail.transaction.txn_date}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div>
                  <div className="font-medium tabular-nums">{RM(Number(detail.transaction.amount))}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                  <StatusBadge status={detail.transaction.status} />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Posted by</div>
                  <div>
                    {agentLabel(detail.transaction.posted_by_agent)}
                    {detail.transaction.posted_by_agent === "manual" && detail.transaction.agent_version && (
                      <span className="text-muted-foreground"> · {detail.transaction.agent_version}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Type</div>
                  <div className="capitalize">{detail.transaction.txn_type.replace(/_/g, " ")}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Period</div>
                  <div className="tabular-nums">{detail.transaction.period}</div>
                </div>
              </section>
              {detail.transaction.reversed_by_id && (
                <section className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-xs text-amber-700">
                  Reversed by counter-journal <span className="break-all font-mono">{detail.transaction.reversed_by_id}</span>
                </section>
              )}
              <section>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Lines</div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Account</th>
                        <th className="px-2 py-1.5 text-right font-medium">Debit</th>
                        <th className="px-2 py-1.5 text-right font-medium">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-2 py-1.5">
                            <span className="font-mono tabular-nums">{l.account_code}</span>{" "}
                            {l.account_name ?? accountNames.get(l.account_code) ?? ""}
                            {l.memo && <div className="text-[10px] text-muted-foreground">{l.memo}</div>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.debit) > 0 ? RM(Number(l.debit)) : ""}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.credit) > 0 ? RM(Number(l.credit)) : ""}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/20 font-medium">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{RM(detailTotals.d)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{RM(detailTotals.c)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
          {detail && canPost && detail.transaction.status === "posted" && (
            <div className="border-t px-6 py-3">
              <Button variant="outline" size="sm" onClick={reverseOpen} disabled={reversing}>
                {reversing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
                Reverse
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <NewJournalSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        companies={companies}
        defaultCompanyId={companyId}
        accounts={accounts}
        outlets={outlets}
        onPosted={() => mutate()}
      />
      <ConfirmDialog />
    </div>
  );
}
