"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Sparkles } from "lucide-react";

type BrioEmployee = {
  briohr_id: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  office?: string;
  job_title?: string;
  employment_type?: string;
  join_date?: string;
  ic_number?: string;
  basic_salary?: number;
};

type MatchResult = {
  brio_employee: BrioEmployee;
  matches: Array<{ user_id: string; name: string; score: number; reason: string; already_linked: boolean }>;
  suggested_user_id: string | null;
};

const SAMPLE_CSV = `briohr_id,name,email,department,office,job_title,employment_type,join_date,basic_salary
CC001,Ammar bin Shahrin,ammar.shahrin+1@gmail.com,HQ,Celsius Coffee HQ,Director,part_time,2021-01-01,5000
CC006,Muhamad Syafiq Aiman bin Mohamed Kaberi,syafiqkaberii@gmail.com,HQ,Celsius Coffee HQ,Barista Lead,full_time,2022-06-15,2500`;

export default function BrioHRImportPage() {
  const [csvText, setCsvText] = useState("");
  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({}); // briohr_id -> user_id
  const [applyResult, setApplyResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);

  const parseCSV = (text: string): BrioEmployee[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const employees: BrioEmployee[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim());
      if (cells.length === 0 || !cells[0]) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = cells[idx] || ""; });

      const emp: BrioEmployee = {
        briohr_id: obj.briohr_id || obj.id || obj.employee_id || "",
        name: obj.name || obj.employee_name || obj.full_name || "",
      };
      if (!emp.briohr_id || !emp.name) continue;

      if (obj.email) emp.email = obj.email;
      if (obj.phone) emp.phone = obj.phone;
      if (obj.department) emp.department = obj.department;
      if (obj.office) emp.office = obj.office;
      if (obj.job_title || obj.position) emp.job_title = obj.job_title || obj.position;
      if (obj.employment_type || obj.type) emp.employment_type = (obj.employment_type || obj.type).toLowerCase().replace(/[^a-z_]/g, "_").replace("parttime", "part_time").replace("fulltime", "full_time");
      if (obj.join_date) emp.join_date = obj.join_date;
      if (obj.ic_number || obj.ic) emp.ic_number = obj.ic_number || obj.ic;
      if (obj.basic_salary || obj.salary) emp.basic_salary = parseFloat((obj.basic_salary || obj.salary).replace(/,/g, "")) || 0;

      employees.push(emp);
    }
    return employees;
  };

  const handlePreview = async () => {
    setLoading(true);
    try {
      const parsed = parseCSV(csvText);
      if (parsed.length === 0) {
        alert("No valid rows found. Check CSV format.");
        return;
      }

      const res = await fetch("/api/hr/briohr-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "match", employees: parsed }),
      });
      const data = await res.json();
      if (res.ok) {
        setResults(data.results);
        // Auto-select suggested matches
        const auto: Record<string, string> = {};
        data.results.forEach((r: MatchResult) => {
          if (r.suggested_user_id) auto[r.brio_employee.briohr_id] = r.suggested_user_id;
        });
        setSelections(auto);
        setStep("review");
      } else {
        alert(data.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      const matches = results
        .filter((r) => selections[r.brio_employee.briohr_id])
        .map((r) => ({
          briohr_id: r.brio_employee.briohr_id,
          user_id: selections[r.brio_employee.briohr_id],
          brio_data: r.brio_employee,
        }));

      const res = await fetch("/api/hr/briohr-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", matches }),
      });
      const data = await res.json();
      if (res.ok) {
        setApplyResult(data);
        setStep("done");
      } else {
        alert(data.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = Object.values(selections).filter(Boolean).length;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/hr/employees" className="rounded-lg p-1 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Import from BrioHR</h1>
          <p className="text-sm text-muted-foreground">Match BrioHR employees to current users</p>
        </div>
      </div>

      {/* STEP 1: Input */}
      {step === "input" && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Upload className="h-5 w-5 text-terracotta" /> Paste CSV from BrioHR
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Export employee list from BrioHR as CSV and paste below. Columns: <code className="rounded bg-gray-100 px-1 text-xs">briohr_id, name, email, phone, department, office, job_title, employment_type, join_date, ic_number, basic_salary</code>
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={10}
            placeholder={SAMPLE_CSV}
            className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={loading || !csvText.trim()}
              className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Preview Matches
            </button>
            <button
              onClick={() => setCsvText(SAMPLE_CSV)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Use sample
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Review */}
      {step === "review" && (
        <>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{results.length} BrioHR employees found</p>
                <p className="text-sm text-muted-foreground">
                  {selectedCount} matched · {results.length - selectedCount} unmatched
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setStep("input"); setResults([]); }}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Back
                </button>
                <button
                  onClick={handleApply}
                  disabled={loading || selectedCount === 0}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Apply {selectedCount} matches
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {results.map((r) => {
              const selected = selections[r.brio_employee.briohr_id] || "";
              return (
                <div key={r.brio_employee.briohr_id} className="rounded-xl border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">{r.brio_employee.briohr_id}</span>
                        <p className="font-semibold">{r.brio_employee.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.brio_employee.email || ""} {r.brio_employee.department && ` · ${r.brio_employee.department}`}
                        {r.brio_employee.job_title && ` · ${r.brio_employee.job_title}`}
                        {r.brio_employee.basic_salary ? ` · RM ${r.brio_employee.basic_salary.toLocaleString()}/mo` : ""}
                      </p>
                    </div>
                    {r.matches.length === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                        <AlertCircle className="h-3 w-3" /> No match
                      </span>
                    )}
                  </div>

                  {r.matches.length > 0 && (
                    <select
                      value={selected}
                      onChange={(e) => setSelections({ ...selections, [r.brio_employee.briohr_id]: e.target.value })}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    >
                      <option value="">-- Skip (don&apos;t match) --</option>
                      {r.matches.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.name} ({Math.round(m.score * 100)}%) — {m.reason}
                          {m.already_linked ? " — already linked" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* STEP 3: Done */}
      {step === "done" && applyResult && (
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <h2 className="text-lg font-semibold">Import Complete</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-green-50 p-3">
              <p className="text-2xl font-bold text-green-700">{applyResult.created}</p>
              <p className="text-sm text-green-600">Profiles created</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-2xl font-bold text-blue-700">{applyResult.updated}</p>
              <p className="text-sm text-blue-600">Profiles updated</p>
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-red-50 p-3">
              <p className="mb-1 font-medium text-red-700">Errors:</p>
              {applyResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Link href="/hr/employees" className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark">
              View Employees
            </Link>
            <button
              onClick={() => { setStep("input"); setCsvText(""); setResults([]); setSelections({}); setApplyResult(null); }}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
