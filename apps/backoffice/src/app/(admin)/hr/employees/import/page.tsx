"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Upload, Loader2, Sparkles, CheckCircle2, AlertTriangle, Trash2,
} from "lucide-react";

type ParsedRecord = {
  fileName: string;
  name: string;
  fullName: string | null;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  position: string | null;
  outletName: string | null;
  joinDate: string | null;
  basicSalary: number | null;
  hourlyRate: number | null;
  performanceAllowance: number | null;
  phone: string | null;
  email: string | null;
  icNumber: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  error?: string;
};

type EditableRecord = ParsedRecord & {
  role: "STAFF" | "MANAGER" | "ADMIN" | "OWNER";
  outletId: string | null;
  skip: boolean;
};

type CommitResult = {
  fileName: string;
  status: "created" | "skipped" | "error";
  userId?: string;
  error?: string;
};

type Outlet = { id: string; name: string; code: string };

export default function LoeImportPage() {
  const router = useRouter();
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const [files, setFiles] = useState<File[]>([]);
  const [records, setRecords] = useState<EditableRecord[]>([]);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [results, setResults] = useState<CommitResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const resolveOutletId = (name: string | null): string | null => {
    if (!name || !outlets) return null;
    const q = name.toLowerCase();
    const match = outlets.find((o) =>
      o.name.toLowerCase().includes(q) || q.includes(o.name.toLowerCase()),
    );
    return match?.id || null;
  };

  const onFilesChosen = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list);
    setFiles(next);
    setRecords([]);
    setResults([]);
  };

  const parseFiles = async (filesToParse: File[]) => {
    if (filesToParse.length === 0) return;
    setParsing(true);
    try {
      const fd = new FormData();
      filesToParse.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/hr/loe-import/extract", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Extract failed" }));
        alert(b?.error || "Extract failed");
        return;
      }
      const { records: parsed } = (await res.json()) as { records: ParsedRecord[] };
      const editable: EditableRecord[] = parsed.map((r) => ({
        ...r,
        role: "STAFF",
        outletId: resolveOutletId(r.outletName),
        skip: !!r.error,
      }));
      setRecords(editable);
    } finally {
      setParsing(false);
    }
  };

  const parseAll = () => parseFiles(files);

  const acceptFile = (f: File) =>
    f.type === "application/pdf" || f.type.startsWith("image/") ||
    /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name);

  const onDropFiles = (dropped: File[]) => {
    const valid = dropped.filter(acceptFile);
    if (valid.length === 0) return;
    setFiles(valid);
    setRecords([]);
    setResults([]);
    void parseFiles(valid);
  };

  const updateField = <K extends keyof EditableRecord>(i: number, key: K, value: EditableRecord[K]) => {
    setRecords((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  };

  const removeRow = (i: number) => {
    setRecords((rs) => rs.filter((_, idx) => idx !== i));
    setFiles((fs) => fs.filter((_, idx) => idx !== i));
  };

  const commitAll = async () => {
    const toCommit = records.filter((r) => !r.skip);
    if (toCommit.length === 0) {
      alert("Nothing to commit — every row is skipped.");
      return;
    }
    setCommitting(true);
    try {
      const fd = new FormData();
      // Include files keyed by their original index so the server can line
      // them up with each record's `fileIndex`.
      records.forEach((r, idx) => {
        if (r.skip) return;
        fd.append(`file_${idx}`, files[idx]);
      });
      const payload = records
        .map((r, idx) => (r.skip ? null : {
          fileIndex: idx,
          name: r.name,
          fullName: r.fullName,
          role: r.role,
          employmentType: r.employmentType,
          position: r.position,
          outletId: r.outletId,
          joinDate: r.joinDate,
          basicSalary: r.basicSalary,
          hourlyRate: r.hourlyRate,
          performanceAllowance: r.performanceAllowance,
          phone: r.phone,
          email: r.email,
          icNumber: r.icNumber,
          notes: r.notes,
        }))
        .filter((x) => x !== null);
      fd.append("records", JSON.stringify(payload));

      const res = await fetch("/api/hr/loe-import/commit", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Commit failed" }));
        alert(b?.error || "Commit failed");
        return;
      }
      const { results: resResults } = (await res.json()) as { results: CommitResult[] };
      setResults(resResults);
    } finally {
      setCommitting(false);
    }
  };

  const confidenceColor = (c: ParsedRecord["confidence"]) =>
    c === "high" ? "bg-emerald-100 text-emerald-700"
    : c === "medium" ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";

  const allCreated = results.length > 0 && results.every((r) => r.status === "created");

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link href="/hr/employees" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to employees
      </Link>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-terracotta" /> Import Employees from LoE
        </h1>
        <p className="text-sm text-muted-foreground">
          Drop Letters of Employment (PDF) — we&apos;ll parse each one, let you review, then create
          the User + profile + attach the LoE as a document in one go.
        </p>
      </div>

      {/* Step 1 — File picker */}
      {records.length === 0 && (
        <div
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!parsing) setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!parsing) setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            if (parsing) return;
            const dropped = Array.from(e.dataTransfer.files || []);
            if (dropped.length > 0) onDropFiles(dropped);
          }}
          className={
            "rounded-xl border-2 border-dashed p-10 text-center transition " +
            (dragOver
              ? "border-terracotta bg-terracotta/5"
              : "border-gray-300 bg-card")
          }
        >
          {parsing ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-terracotta" />
          ) : (
            <Upload className={"mx-auto h-8 w-8 " + (dragOver ? "text-terracotta" : "text-muted-foreground")} />
          )}
          <p className="mt-3 text-sm font-medium">
            {parsing ? "Parsing with AI…" : dragOver ? "Drop to parse" : "Drop LoE PDFs here, or"}
          </p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90">
            Choose files
            <input
              type="file"
              multiple
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => onFilesChosen(e.target.files)}
            />
          </label>
          {files.length > 0 && (
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <div>{files.length} file{files.length === 1 ? "" : "s"} selected</div>
              <ul className="mt-1 list-disc text-left pl-6">
                {files.slice(0, 8).map((f) => <li key={f.name}>{f.name}</li>)}
                {files.length > 8 && <li>…and {files.length - 8} more</li>}
              </ul>
              <button
                onClick={parseAll}
                disabled={parsing}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Parse with AI
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Review table */}
      {records.length > 0 && results.length === 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Review the parsed data. Uncheck Skip to exclude a row, or edit fields inline.
              Click Create when ready.
            </p>
            <button
              onClick={() => { setFiles([]); setRecords([]); setResults([]); }}
              className="text-xs text-muted-foreground hover:underline"
            >
              Start over
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2 text-left">File / Conf.</th>
                  <th className="px-2 py-2 text-left">Name</th>
                  <th className="px-2 py-2 text-left">Full name</th>
                  <th className="px-2 py-2 text-left">Role</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Position</th>
                  <th className="px-2 py-2 text-left">Outlet</th>
                  <th className="px-2 py-2 text-left">Join</th>
                  <th className="px-2 py-2 text-right">Basic</th>
                  <th className="px-2 py-2 text-right">Hr/rate</th>
                  <th className="px-2 py-2 text-right">Perf</th>
                  <th className="px-2 py-2 text-left">Skip</th>
                  <th className="px-2 py-2 text-left">⌫</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i} className={`border-t ${r.skip ? "bg-muted/20 opacity-60" : ""}`}>
                    <td className="px-2 py-2 max-w-[180px]">
                      <div className="truncate font-medium">{r.fileName}</div>
                      <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${confidenceColor(r.confidence)}`}>
                        {r.confidence}
                      </span>
                      {r.error && <div className="mt-1 text-[10px] text-red-600">{r.error}</div>}
                    </td>
                    <td className="px-2 py-2"><input className="w-32 rounded border bg-background px-2 py-1" value={r.name} onChange={(e) => updateField(i, "name", e.target.value)} /></td>
                    <td className="px-2 py-2"><input className="w-48 rounded border bg-background px-2 py-1" value={r.fullName ?? ""} onChange={(e) => updateField(i, "fullName", e.target.value || null)} /></td>
                    <td className="px-2 py-2">
                      <select className="rounded border bg-background px-1 py-1" value={r.role} onChange={(e) => updateField(i, "role", e.target.value as EditableRecord["role"])}>
                        <option>STAFF</option><option>MANAGER</option><option>ADMIN</option><option>OWNER</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select className="rounded border bg-background px-1 py-1" value={r.employmentType} onChange={(e) => updateField(i, "employmentType", e.target.value as EditableRecord["employmentType"])}>
                        <option value="full_time">Full-time</option>
                        <option value="part_time">Part-time</option>
                        <option value="contract">Contract</option>
                        <option value="intern">Intern</option>
                      </select>
                    </td>
                    <td className="px-2 py-2"><input className="w-28 rounded border bg-background px-2 py-1" value={r.position ?? ""} onChange={(e) => updateField(i, "position", e.target.value || null)} /></td>
                    <td className="px-2 py-2">
                      <select className="rounded border bg-background px-1 py-1" value={r.outletId ?? ""} onChange={(e) => updateField(i, "outletId", e.target.value || null)}>
                        <option value="">(none)</option>
                        {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      {r.outletName && !r.outletId && (
                        <div className="mt-0.5 text-[9px] text-amber-700">AI guess: {r.outletName}</div>
                      )}
                    </td>
                    <td className="px-2 py-2"><input type="date" className="rounded border bg-background px-2 py-1" value={r.joinDate ?? ""} onChange={(e) => updateField(i, "joinDate", e.target.value || null)} /></td>
                    <td className="px-2 py-2 text-right"><input type="number" step="0.01" className="w-20 rounded border bg-background px-1 py-1 text-right" value={r.basicSalary ?? ""} onChange={(e) => updateField(i, "basicSalary", e.target.value ? Number(e.target.value) : null)} /></td>
                    <td className="px-2 py-2 text-right"><input type="number" step="0.01" className="w-16 rounded border bg-background px-1 py-1 text-right" value={r.hourlyRate ?? ""} onChange={(e) => updateField(i, "hourlyRate", e.target.value ? Number(e.target.value) : null)} /></td>
                    <td className="px-2 py-2 text-right"><input type="number" step="0.01" className="w-16 rounded border bg-background px-1 py-1 text-right" value={r.performanceAllowance ?? ""} onChange={(e) => updateField(i, "performanceAllowance", e.target.value ? Number(e.target.value) : null)} /></td>
                    <td className="px-2 py-2"><input type="checkbox" checked={r.skip} onChange={(e) => updateField(i, "skip", e.target.checked)} /></td>
                    <td className="px-2 py-2"><button onClick={() => removeRow(i)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3 w-3" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={commitAll}
              disabled={committing}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Create {records.filter((r) => !r.skip).length} employee{records.filter((r) => !r.skip).length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className={`rounded-xl border p-4 ${allCreated ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-2 font-semibold">
              {allCreated ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
              {results.filter((r) => r.status === "created").length} created ·
              {" "}{results.filter((r) => r.status === "skipped").length} skipped ·
              {" "}{results.filter((r) => r.status === "error").length} errored
            </div>
          </div>

          <div className="divide-y rounded-xl border bg-card">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 text-sm">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    r.status === "created"
                      ? "bg-emerald-100 text-emerald-700"
                      : r.status === "skipped"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                  }`}
                >
                  {r.status}
                </span>
                <span className="font-medium">{r.fileName}</span>
                {r.error && <span className="text-xs text-muted-foreground">— {r.error}</span>}
                {r.userId && (
                  <Link href={`/hr/employees/${r.userId}`} className="ml-auto text-xs text-terracotta hover:underline">
                    Open profile →
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setFiles([]); setRecords([]); setResults([]); }}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
            >
              Import more
            </button>
            <button
              onClick={() => router.push("/hr/employees")}
              className="rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90"
            >
              Back to Employees
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
