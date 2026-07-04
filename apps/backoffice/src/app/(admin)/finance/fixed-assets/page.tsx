"use client";

// Fixed assets register: straight-line depreciation over useful life.
// One math everywhere (lib/finance/fixed-assets.ts): the register columns
// below, the sourced P&L "Depreciation" line and the monthly GL posting all
// share it, so the numbers always tie.
//
// Three flows on this page:
//   1. Add asset (manual, or one click "Capitalize" on an EQUIPMENTS bank line)
//   2. Run depreciation for a month: per-company preview, then post ONE
//      idempotent journal per company (Dr 6512, Cr 1550-xx)
//   3. Dispose: stops depreciation from the disposal month onward (v1 posts
//      no gain or loss journal)

import { useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Badge,
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useConfirm,
  usePrompt,
} from "@celsius/ui";
import { Calculator, Landmark, Loader2, Pencil, Plus } from "lucide-react";

// Accounting format: negatives in parentheses, same as the Reports page.
const RM = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "0.00";
  const f = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Math.abs(n));
  return n < 0 ? `(${f})` : f;
};

// The 1500-xx PP&E accounts seeded in 003_finance_coa_seed.sql. The API
// validates the code against fin_accounts on every write.
const PPE_ACCOUNTS: [string, string][] = [
  ["1500-00", "Coffee machines"],
  ["1500-01", "Furniture and fittings"],
  ["1500-02", "Kitchen equipment"],
  ["1500-03", "Office equipment"],
  ["1500-04", "Renovation"],
  ["1500-05", "Signboard"],
];

type Asset = {
  id: string;
  companyId: string | null;
  outletId: string | null;
  outletName: string | null;
  name: string;
  accountCode: string;
  cost: number;
  residual: number;
  acquiredDate: string;
  usefulLifeMonths: number;
  status: string;
  disposedDate: string | null;
  sourceBankLineId: string | null;
  notes: string | null;
  monthlyDep: number;
  accumulated: number;
  nbv: number;
};

type Company = { id: string; name: string };
type Outlet = { id: string; name: string };

type CapLine = {
  id: string;
  date: string;
  description: string;
  amount: number;
  companyId: string;
  outletId: string | null;
  outletName: string | null;
};

type RunCompany = {
  companyId: string;
  total: number;
  byAsset: { id: string; name: string; accountCode: string; amount: number }[];
  alreadyPosted: boolean;
  transactionId: string | null;
};
type RunResult = { yearMonth: string; committed: boolean; companies: RunCompany[] };

type FormState = {
  id?: string;            // set = edit
  bankLineId?: string;    // set = capitalizing a bank line
  name: string;
  companyId: string;
  outletId: string;
  accountCode: string;
  cost: string;
  residual: string;
  acquiredDate: string;
  usefulLifeMonths: string;
  notes: string;
};

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function previousMonthMyt(): string {
  const t = todayMyt();
  const [y, m] = t.split("-").map(Number);
  const i = y * 12 + (m - 1) - 1;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

const emptyForm = (): FormState => ({
  name: "",
  companyId: "",
  outletId: "",
  accountCode: "1500-02",
  cost: "",
  residual: "0",
  acquiredDate: todayMyt(),
  usefulLifeMonths: "60",
  notes: "",
});

export default function FixedAssetsPage() {
  const { data, isLoading, mutate } = useFetch<{ assets: Asset[] }>("/api/finance/fixed-assets");
  const { data: capData, mutate: mutateCap } = useFetch<{ lines: CapLine[] }>("/api/finance/fixed-assets/capitalizable");
  const { data: companiesData } = useFetch<{ companies: Company[] }>("/api/finance/companies");
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [runYm, setRunYm] = useState(previousMonthMyt());
  const [runPreview, setRunPreview] = useState<RunResult | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const capLines = capData?.lines ?? [];
  const companies = useMemo(() => companiesData?.companies ?? [], [companiesData]);
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const accountName = useMemo(() => new Map(PPE_ACCOUNTS), []);

  const totals = useMemo(
    () =>
      assets.reduce(
        (t, a) => ({
          cost: t.cost + a.cost,
          monthly: t.monthly + a.monthlyDep,
          accumulated: t.accumulated + a.accumulated,
          nbv: t.nbv + a.nbv,
        }),
        { cost: 0, monthly: 0, accumulated: 0, nbv: 0 }
      ),
    [assets]
  );

  const openAdd = () => { setForm({ ...emptyForm(), companyId: companies[0]?.id ?? "" }); setFormError(""); };
  const openEdit = (a: Asset) => {
    setForm({
      id: a.id,
      name: a.name,
      companyId: a.companyId ?? "",
      outletId: a.outletId ?? "",
      accountCode: a.accountCode,
      cost: String(a.cost),
      residual: String(a.residual),
      acquiredDate: a.acquiredDate,
      usefulLifeMonths: String(a.usefulLifeMonths),
      notes: a.notes ?? "",
    });
    setFormError("");
  };
  const openCapitalize = (l: CapLine) => {
    setForm({
      bankLineId: l.id,
      name: l.description,
      companyId: l.companyId,
      outletId: l.outletId ?? "",
      accountCode: "1500-02",
      cost: l.amount.toFixed(2),
      residual: "0",
      acquiredDate: l.date,
      usefulLifeMonths: "60",
      notes: "",
    });
    setFormError("");
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError("");
    const isEdit = !!form.id;
    const res = await fetch(isEdit ? `/api/finance/fixed-assets/${form.id}` : "/api/finance/fixed-assets", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEdit
          ? {
              name: form.name,
              usefulLifeMonths: Number(form.usefulLifeMonths),
              residual: Number(form.residual || 0),
              accountCode: form.accountCode,
              outletId: form.outletId || null,
              notes: form.notes || null,
            }
          : {
              bankLineId: form.bankLineId,
              name: form.name,
              companyId: form.companyId,
              outletId: form.outletId || null,
              accountCode: form.accountCode,
              cost: Number(form.cost),
              residual: Number(form.residual || 0),
              acquiredDate: form.acquiredDate,
              usefulLifeMonths: Number(form.usefulLifeMonths),
              notes: form.notes || null,
            }
      ),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setFormError(body?.error || "Save failed");
      return;
    }
    setForm(null);
    mutate();
    mutateCap();
    setRunPreview(null);
  };

  const dispose = async (a: Asset) => {
    const date = await prompt({
      title: `Dispose ${a.name}`,
      description:
        "Disposal date (YYYY-MM-DD). Depreciation stops from the disposal month onward. No gain or loss journal is posted in v1; the cost stays on the books until a disposal journal is added.",
      defaultValue: todayMyt(),
      required: true,
      validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? null : "Use YYYY-MM-DD"),
      confirmLabel: "Dispose",
    });
    if (!date) return;
    const res = await fetch("/api/finance/fixed-assets/dispose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, disposedOn: date.trim() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error || "Dispose failed");
      return;
    }
    mutate();
    setRunPreview(null);
  };

  const previewRun = async () => {
    if (!/^\d{4}-\d{2}$/.test(runYm)) { setRunError("Pick a month"); return; }
    setRunLoading(true);
    setRunError("");
    const res = await fetch(`/api/finance/fixed-assets/run-depreciation?yearMonth=${runYm}`);
    const body = await res.json().catch(() => null);
    setRunLoading(false);
    if (!res.ok) { setRunError(body?.error || "Preview failed"); return; }
    setRunPreview(body as RunResult);
  };

  const postRun = async () => {
    if (!runPreview) return;
    const toPost = runPreview.companies.filter((c) => !c.alreadyPosted);
    if (!toPost.length) return;
    const ok = await confirm({
      title: `Post depreciation for ${runYm}?`,
      description: `Posts ${toPost.length} journal${toPost.length > 1 ? "s" : ""} (one per company, Dr 6512 Depreciation, Cr 1550-xx Accumulated depreciation), total ${RM(toPost.reduce((s, c) => s + c.total, 0))}, dated on the month's last day. Re-running the same month never double posts.`,
      confirmLabel: "Post journals",
    });
    if (!ok) return;
    setRunLoading(true);
    setRunError("");
    const res = await fetch("/api/finance/fixed-assets/run-depreciation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearMonth: runYm }),
    });
    const body = await res.json().catch(() => null);
    setRunLoading(false);
    if (!res.ok) { setRunError(body?.error || "Posting failed"); return; }
    setRunPreview(body as RunResult);
  };

  const statusBadge = (a: Asset) => {
    if (a.status === "disposed") {
      return <Badge className="bg-gray-500/10 text-gray-500 text-[10px]">Disposed{a.disposedDate ? ` ${a.disposedDate}` : ""}</Badge>;
    }
    if (a.nbv <= a.residual) {
      return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">Fully depreciated</Badge>;
    }
    return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 text-[10px]">Active</Badge>;
  };

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold">Fixed Assets</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
            Straight-line register. Depreciation starts the first full month after acquisition and feeds the
            sourced P&amp;L and the monthly GL journal from the same math.
          </p>
        </div>
        <Button onClick={openAdd} className="w-full sm:w-auto">
          <Plus className="mr-1.5 h-4 w-4" /> Add asset
        </Button>
      </div>

      {/* Register */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : assets.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No fixed assets yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Add one manually or capitalize an EQUIPMENTS bank line below.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Outlet</th>
                  <th className="px-3 py-2 font-medium">Acquired</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Life (mo)</th>
                  <th className="px-3 py-2 text-right font-medium">Monthly dep</th>
                  <th className="px-3 py-2 text-right font-medium">Accumulated</th>
                  <th className="px-3 py-2 text-right font-medium">NBV</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className={`border-t hover:bg-muted/30 ${a.status === "disposed" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{a.name}</span>
                      <p className="text-[11px] text-muted-foreground">
                        {a.accountCode} {accountName.get(a.accountCode) ?? ""}
                        {a.sourceBankLineId ? " · from bank line" : ""}
                        {a.notes ? ` · ${a.notes}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs">{a.companyId ? (companyName.get(a.companyId) ?? a.companyId) : "?"}</td>
                    <td className="px-3 py-2 text-xs">{a.outletName ?? <span className="text-muted-foreground">HQ</span>}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{a.acquiredDate}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{RM(a.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.usefulLifeMonths}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{RM(a.monthlyDep)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{RM(a.accumulated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{RM(a.nbv)}</td>
                    <td className="px-3 py-2">{statusBadge(a)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openEdit(a)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {a.status !== "disposed" && (
                          <Button size="xs" variant="outline" onClick={() => dispose(a)}>Dispose</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td colSpan={4} className="px-3 py-2">Total ({assets.length} asset{assets.length > 1 ? "s" : ""})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{RM(totals.cost)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{RM(totals.monthly)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{RM(totals.accumulated)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{RM(totals.nbv)}</td>
                  <td colSpan={2} className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Capitalize from bank */}
        <section className="overflow-hidden rounded-md border bg-card">
          <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Landmark className="h-3.5 w-3.5" /> Capitalize from bank (EQUIPMENTS lines)
          </header>
          {capLines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No uncapitalized EQUIPMENTS bank lines. Classified equipment outflows appear here for one-click capitalization.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {capLines.map((l) => (
                    <tr key={l.id} className="border-t first:border-t-0 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">{l.date}</td>
                      <td className="px-3 py-2">
                        <span className="line-clamp-1">{l.description}</span>
                        <p className="text-[11px] text-muted-foreground">
                          {companyName.get(l.companyId) ?? l.companyId}{l.outletName ? ` · ${l.outletName}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{RM(l.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="xs" variant="outline" onClick={() => openCapitalize(l)}>Capitalize</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Run depreciation */}
        <section className="overflow-hidden rounded-md border bg-card">
          <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Calculator className="h-3.5 w-3.5" /> Run depreciation
          </header>
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={runYm}
                onChange={(e) => { setRunYm(e.target.value); setRunPreview(null); }}
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <Button size="xs" variant="outline" onClick={previewRun} disabled={runLoading}>
                {runLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Preview"}
              </Button>
              {runPreview && runPreview.companies.some((c) => !c.alreadyPosted) && !runPreview.committed && (
                <Button size="xs" onClick={postRun} disabled={runLoading}>Post journals</Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              One journal per company, dated on the month&apos;s last day: Dr 6512 Depreciation of PP&amp;E,
              Cr 1550-xx Accumulated depreciation. Idempotent, so re-running a month never double posts.
            </p>
            {runError && <p className="text-xs text-destructive">{runError}</p>}
            {runPreview && (
              runPreview.companies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No depreciation charges for {runPreview.yearMonth}.</p>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {runPreview.companies.map((c) => (
                        <tr key={c.companyId} className="border-t first:border-t-0">
                          <td className="px-3 py-2">
                            <span className="font-medium">{companyName.get(c.companyId) ?? c.companyId}</span>
                            <p className="text-[11px] text-muted-foreground">
                              {c.byAsset.length} asset{c.byAsset.length > 1 ? "s" : ""}: {c.byAsset.map((a) => `${a.name} ${RM(a.amount)}`).join(", ")}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{RM(c.total)}</td>
                          <td className="px-3 py-2 text-right">
                            {c.alreadyPosted ? (
                              <Badge className="bg-gray-500/10 text-gray-500 text-[10px]">Already posted</Badge>
                            ) : c.transactionId ? (
                              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 text-[10px]">Posted</Badge>
                            ) : (
                              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]">Preview</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </section>
      </div>

      {/* Add / Edit / Capitalize drawer */}
      <Sheet open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {form?.id ? "Edit asset" : form?.bankLineId ? "Capitalize bank line" : "Add asset"}
            </SheetTitle>
          </SheetHeader>
          {form && (
            <div className="mt-4 space-y-3">
              {form.bankLineId && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  Linked to the selected EQUIPMENTS bank line; that line can never be capitalized twice.
                  EQUIPMENTS outflows are already excluded from the P&amp;L, so this only starts depreciation.
                </p>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. La Marzocco Linea PB" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Company</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
                    value={form.companyId}
                    disabled={!!form.id}
                    onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                  >
                    <option value="">Select company</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Outlet (optional)</label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.outletId}
                    onChange={(e) => setForm({ ...form, outletId: e.target.value })}
                  >
                    <option value="">HQ (no outlet)</option>
                    {(outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">PP&amp;E account</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.accountCode}
                  onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                >
                  {PPE_ACCOUNTS.map(([code, label]) => <option key={code} value={code}>{code} {label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Cost (RM)</label>
                  <Input type="number" step="0.01" value={form.cost} disabled={!!form.id} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Residual value (RM)</label>
                  <Input type="number" step="0.01" value={form.residual} onChange={(e) => setForm({ ...form, residual: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Acquired on</label>
                  <input
                    type="date"
                    value={form.acquiredDate}
                    disabled={!!form.id}
                    onChange={(e) => setForm({ ...form, acquiredDate: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Useful life (months)</label>
                  <Input type="number" step="1" min="1" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                First charge lands the month AFTER acquisition (no partial months). Monthly charge =
                (cost minus residual) / life, and the final month absorbs rounding so lifetime
                depreciation sums exactly.
              </p>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setForm(null)}>Cancel</Button>
                <Button className="flex-1" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : form.id ? "Save changes" : form.bankLineId ? "Capitalize" : "Add asset"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog />
      <PromptDialog />
    </div>
  );
}
