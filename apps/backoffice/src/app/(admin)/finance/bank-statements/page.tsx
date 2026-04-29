"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, X, Upload, FileDown, FileSpreadsheet, AlertTriangle, Pencil } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type BankStatement = {
  id: string;
  accountName: string | null;
  statementDate: string;
  closingBalance: number;
  periodStart: string | null;
  periodEnd: string | null;
  totalInflows: number | null;
  totalOutflows: number | null;
  interCoInflows: number | null;
  interCoOutflows: number | null;
  fileUrl: string | null;
  notes: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
};

type ParsedLine = {
  txnDate: string;
  description: string;
  reference: string | null;
  amount: number;
  direction: "CR" | "DR";
};

type ParseResult = {
  totalInflows: number;
  totalOutflows: number;
  periodStart: string | null;
  periodEnd: string | null;
  rowsParsed: number;
  warnings: string[];
  fileName: string;
  fileSize: number;
  lines: ParsedLine[];
};

export default function BankStatementsPage() {
  const { data, isLoading, mutate } = useFetch<BankStatement[]>("/api/finance/bank-statements");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("Maybank Operating");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split("T")[0]);
  const [closingBalance, setClosingBalance] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [totalInflows, setTotalInflows] = useState("");
  const [totalOutflows, setTotalOutflows] = useState("");
  const [interCoInflows, setInterCoInflows] = useState("");
  const [interCoOutflows, setInterCoOutflows] = useState("");
  const [notes, setNotes] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const items = data ?? [];

  const reset = () => {
    setAdding(false);
    setEditingId(null);
    setAccountName("Maybank Operating");
    setStatementDate(new Date().toISOString().split("T")[0]);
    setClosingBalance("");
    setPeriodStart(""); setPeriodEnd("");
    setTotalInflows(""); setTotalOutflows("");
    setInterCoInflows(""); setInterCoOutflows("");
    setNotes("");
    setFileUrl(null);
    setParseResult(null);
    setError("");
  };

  const openEdit = (s: BankStatement) => {
    setEditingId(s.id);
    setAccountName(s.accountName ?? "");
    setStatementDate(s.statementDate.slice(0, 10));
    setClosingBalance(String(s.closingBalance));
    setPeriodStart(s.periodStart?.slice(0, 10) ?? "");
    setPeriodEnd(s.periodEnd?.slice(0, 10) ?? "");
    setTotalInflows(s.totalInflows == null ? "" : String(s.totalInflows));
    setTotalOutflows(s.totalOutflows == null ? "" : String(s.totalOutflows));
    setInterCoInflows(s.interCoInflows == null ? "" : String(s.interCoInflows));
    setInterCoOutflows(s.interCoOutflows == null ? "" : String(s.interCoOutflows));
    setNotes(s.notes ?? "");
    setFileUrl(s.fileUrl);
    setParseResult(null);
    setError("");
    setAdding(true);
  };

  // Single combined drop-and-parse handler. CSV/XLSX → parse + extract +
  // store in form. PDF/image → just store the file URL for record-keeping;
  // Finance types totals manually.
  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    const isSheet = /\.(csv|xlsx|xls)$/i.test(file.name);

    if (isSheet) {
      setParsing(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/finance/bank-statements/parse", { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          setError(d?.error || "Parse failed");
        } else {
          const r = (await res.json()) as ParseResult;
          setParseResult(r);
          setTotalInflows(String(r.totalInflows));
          setTotalOutflows(String(r.totalOutflows));
          if (r.periodStart) setPeriodStart(r.periodStart);
          if (r.periodEnd) setPeriodEnd(r.periodEnd);
          // Default the statement date to the period end if available.
          if (r.periodEnd) setStatementDate(r.periodEnd);
        }
      } catch {
        setError("Parse failed");
      }
      setParsing(false);
    }

    // Always upload the source for record-keeping (even for sheets, so
    // Finance can re-download the original later for audit).
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inventory/upload", { method: "POST", body: fd });
      if (res.ok) {
        const { url } = await res.json();
        setFileUrl(url);
      }
    } catch { /* non-fatal — Finance can save without the file */ }
    setUploading(false);
    e.target.value = "";
  };

  const save = async () => {
    if (!statementDate || !closingBalance) { setError("Statement date and closing balance required"); return; }
    setSaving(true); setError("");
    const url = editingId ? `/api/finance/bank-statements/${editingId}` : "/api/finance/bank-statements";
    const method = editingId ? "PATCH" : "POST";
    const payload: Record<string, unknown> = {
      closingBalance: parseFloat(closingBalance),
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      totalInflows: totalInflows === "" ? null : parseFloat(totalInflows),
      totalOutflows: totalOutflows === "" ? null : parseFloat(totalOutflows),
      interCoInflows: interCoInflows === "" ? null : parseFloat(interCoInflows),
      interCoOutflows: interCoOutflows === "" ? null : parseFloat(interCoOutflows),
      notes: notes || null,
    };
    // POST also accepts accountName + statementDate + fileUrl; PATCH ignores
    // those (statement date / account are immutable for audit).
    if (!editingId) {
      payload.accountName = accountName || null;
      payload.statementDate = statementDate;
      payload.fileUrl = fileUrl;
      // Forward parsed line items so the server can classify + persist
      // BankStatementLine rows. Only present when a CSV/XLSX was parsed.
      if (parseResult?.lines?.length) payload.lines = parseResult.lines;
    }
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Save failed");
      return;
    }
    reset();
    mutate();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this bank statement?")) return;
    await fetch(`/api/finance/bank-statements/${id}`, { method: "DELETE" });
    mutate();
  };

  const latest = items[0];

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Bank Statements</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Upload weekly statement (CSV/Excel/PDF). The latest closing balance is the cashflow opening balance, and the period inflows/outflows feed the &ldquo;Other (from bank)&rdquo; column on the projection.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="bg-terracotta hover:bg-terracotta-dark w-full sm:w-auto">
          <Plus className="mr-1.5 h-4 w-4" /> New Statement
        </Button>
      </div>

      {latest && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
          <p className="text-xs text-blue-700">Latest closing balance (used as opening balance)</p>
          <p className="mt-0.5 text-2xl font-bold text-blue-900">RM {latest.closingBalance.toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-blue-600">{latest.statementDate.slice(0, 10)} · {latest.accountName ?? "—"} · uploaded by {latest.uploadedBy.name}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">No bank statements uploaded yet.</p>
          <p className="mt-1 text-xs text-gray-400">Upload one so the cashflow has a starting point + flow data.</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Statement Date</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 text-right font-medium">Closing (RM)</th>
                <th className="px-4 py-3 text-right font-medium text-green-700">Inflows</th>
                <th className="px-4 py-3 text-right font-medium text-red-700">Outflows</th>
                <th className="px-4 py-3 text-right font-medium text-blue-700">InterCo</th>
                <th className="px-4 py-3 font-medium">Uploaded By</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-700 font-medium">{s.statementDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-500">
                    {s.periodStart && s.periodEnd ? `${s.periodStart.slice(0,10)} → ${s.periodEnd.slice(0,10)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{s.accountName ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">RM {s.closingBalance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-green-700">{s.totalInflows == null ? "—" : `+${s.totalInflows.toFixed(2)}`}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-red-700">{s.totalOutflows == null ? "—" : `−${s.totalOutflows.toFixed(2)}`}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] text-blue-700">
                    {(s.interCoInflows ?? 0) === 0 && (s.interCoOutflows ?? 0) === 0
                      ? <span className="text-gray-300">—</span>
                      : <>
                          {(s.interCoInflows ?? 0) > 0 && <div>+{(s.interCoInflows ?? 0).toFixed(2)}</div>}
                          {(s.interCoOutflows ?? 0) > 0 && <div>−{(s.interCoOutflows ?? 0).toFixed(2)}</div>}
                        </>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.uploadedBy.name}</td>
                  <td className="px-4 py-3">
                    {s.fileUrl
                      ? <a href={s.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><FileDown className="h-3 w-3" /> View</a>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(s)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(s.id)} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload dialog */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={reset}>
          <div className="relative w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-white p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">{editingId ? "Edit Bank Statement" : "New Bank Statement"}</h3>
              <button onClick={reset} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* File upload + parse */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Upload statement (CSV / Excel / PDF)</label>
                {fileUrl || parseResult ? (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-blue-500" />
                      <span className="flex-1 truncate text-gray-700">{parseResult?.fileName ?? "Uploaded"}</span>
                      <button onClick={() => { setFileUrl(null); setParseResult(null); }} className="text-red-600 hover:underline">Remove</button>
                    </div>
                    {parseResult && (
                      <div className="text-gray-600">
                        <p>Parsed {parseResult.rowsParsed} transaction{parseResult.rowsParsed === 1 ? "" : "s"} {parseResult.periodStart && parseResult.periodEnd ? `(${parseResult.periodStart} → ${parseResult.periodEnd})` : ""}</p>
                        {parseResult.warnings.length > 0 && (
                          <p className="mt-1 flex items-start gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            {parseResult.warnings.join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/30 ${(uploading || parsing) ? "opacity-50 pointer-events-none" : ""}`}>
                    {parsing ? <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Parsing…</>
                              : uploading ? <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Uploading…</>
                              : <><Upload className="h-4 w-4 text-gray-400" /> <span className="text-gray-500">CSV/Excel auto-fills inflows + outflows</span></>}
                    <input type="file" accept=".csv,.xls,.xlsx,application/pdf,image/*" className="hidden" onChange={handleFileChosen} />
                  </label>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Account Name</label>
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Maybank Operating" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Statement Date</label>
                  <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Closing Balance (RM)</label>
                  <Input type="number" step="0.01" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} />
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Period totals (used by cashflow forecast)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Period Start</label>
                    <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Period End</label>
                    <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Total Inflows (RM)</label>
                    <Input type="number" step="0.01" value={totalInflows} onChange={(e) => setTotalInflows(e.target.value)} placeholder="Money in" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Total Outflows (RM)</label>
                    <Input type="number" step="0.01" value={totalOutflows} onChange={(e) => setTotalOutflows(e.target.value)} placeholder="Money out" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400">Auto-filled when you upload a CSV/Excel; you can edit before saving.</p>
              </div>

              {/* InterCo offsets — let finance carve out internal transfers
                  so the cash-generation KPI excludes them. */}
              <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">InterCo offset (optional)</p>
                <p className="text-[10px] text-blue-700/80">Portion of the totals above that was a transfer between Celsius accounts (CCSB ↔ CCT ↔ CCC ↔ any 4th internal account). Subtracted from gross flows so cash generation reflects external movement only.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">InterCo Inflows (RM)</label>
                    <Input type="number" step="0.01" value={interCoInflows} onChange={(e) => setInterCoInflows(e.target.value)} placeholder="Internal transfer received" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">InterCo Outflows (RM)</label>
                    <Input type="number" step="0.01" value={interCoOutflows} onChange={(e) => setInterCoOutflows(e.target.value)} placeholder="Internal transfer sent" />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={reset} className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 rounded-md bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
