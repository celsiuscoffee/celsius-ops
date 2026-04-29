"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, X, Upload, FileDown } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type BankStatement = {
  id: string;
  accountName: string | null;
  statementDate: string;
  closingBalance: number;
  fileUrl: string | null;
  notes: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
};

export default function BankStatementsPage() {
  const { data, isLoading, mutate } = useFetch<BankStatement[]>("/api/finance/bank-statements");
  const [adding, setAdding] = useState(false);
  const [accountName, setAccountName] = useState("Maybank Operating");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split("T")[0]);
  const [closingBalance, setClosingBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const items = data ?? [];

  const reset = () => {
    setAdding(false);
    setAccountName("Maybank Operating");
    setStatementDate(new Date().toISOString().split("T")[0]);
    setClosingBalance("");
    setNotes("");
    setFileUrl(null);
    setError("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inventory/upload", { method: "POST", body: fd });
      if (res.ok) {
        const { url } = await res.json();
        setFileUrl(url);
      } else {
        setError("Upload failed");
      }
    } catch {
      setError("Upload failed");
    }
    setUploading(false);
    e.target.value = "";
  };

  const save = async () => {
    if (!statementDate || !closingBalance) { setError("Statement date and closing balance required"); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/finance/bank-statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountName: accountName || null,
        statementDate,
        closingBalance: parseFloat(closingBalance),
        fileUrl,
        notes: notes || null,
      }),
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
            Upload weekly closing balance — the most recent row is the opening balance for cashflow projections.
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
          <p className="mt-1 text-xs text-gray-400">Upload one so the cashflow has a starting point.</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Statement Date</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 text-right font-medium">Closing Balance (RM)</th>
                <th className="px-4 py-3 font-medium">Uploaded By</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-700 font-medium">{s.statementDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{s.accountName ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">RM {s.closingBalance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.uploadedBy.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    {s.fileUrl
                      ? <a href={s.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><FileDown className="h-3 w-3" /> View</a>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
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
              <h3 className="text-base font-semibold text-gray-900">New Bank Statement</h3>
              <button onClick={reset} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Account Name</label>
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Maybank Operating" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Statement Date</label>
                <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Closing Balance (RM)</label>
                <Input type="number" step="0.01" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Statement File (optional)</label>
                {fileUrl ? (
                  <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                    <FileDown className="h-3.5 w-3.5 text-blue-500" />
                    <span className="flex-1 truncate text-gray-700">Uploaded</span>
                    <button onClick={() => setFileUrl(null)} className="text-red-600 hover:underline">Remove</button>
                  </div>
                ) : (
                  <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/30 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploading ? <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /> Uploading…</>
                              : <><Upload className="h-4 w-4 text-gray-400" /> <span className="text-gray-500">Upload PDF or image</span></>}
                    <input type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={handleFileUpload} />
                  </label>
                )}
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
