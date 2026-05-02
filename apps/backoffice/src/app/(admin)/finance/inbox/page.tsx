"use client";

// Exception inbox — list of items the agents couldn't auto-resolve, plus a
// drop zone for uploading supplier bills. The drawer shows the source doc
// preview alongside the agent's proposal and the action buttons.

import { useState, useRef, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Loader2,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  FileText,
  Bot,
} from "lucide-react";

type ExceptionRow = {
  id: string;
  type: string;
  related_type: string;
  related_id: string;
  agent: string;
  reason: string;
  proposed_action: ProposedAction | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "resolved" | "dismissed";
  created_at: string;
};

type ProposedAction = {
  supplierId?: string;
  supplierName?: string;
  outletId?: string | null;
  categorize?: { accountCode: string | null; confidence: number; reasoning: string; alternativeCodes?: string[] };
  bill?: {
    supplierName: string | null;
    billNumber: string | null;
    billDate: string | null;
    dueDate: string | null;
    subtotal: number | null;
    sst: number | null;
    total: number | null;
    notes: string | null;
    rawWarnings?: string[];
  };
  duplicateOfBillId?: string;
};

type Account = {
  code: string;
  name: string;
  type: string;
};

type ExceptionDetail = {
  exception: ExceptionRow;
  document: {
    id: string;
    source: string;
    source_ref: string;
    doc_type: string;
    raw_url: string | null;
    signed_url: string | null;
    metadata: { uploadedById?: string; mimeType?: string } | null;
    received_at: string;
  } | null;
};

const RM = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

const PRIORITY_COLOR: Record<ExceptionRow["priority"], string> = {
  urgent: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  normal: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
  low: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setLast(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/finance/bills/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setLast(`Failed: ${data.error ?? res.status}`);
      } else if (data.result?.kind === "posted") {
        setLast(`Posted RM ${data.result.total.toFixed(2)} — ${file.name}`);
      } else if (data.result?.kind === "exception") {
        setLast(`Queued for review — ${file.name}`);
      }
      onUploaded();
    } catch (err) {
      setLast(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-4">
      <div className="flex items-center gap-3">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-sm font-medium">Upload supplier bill</div>
          <div className="text-xs text-muted-foreground">
            PDF, JPEG, or PNG. AP agent extracts + categorizes automatically.
          </div>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Choose file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {last && <div className="mt-2 text-xs text-muted-foreground">{last}</div>}
    </div>
  );
}

function Drawer({ id, onClose, onResolved, accounts }: {
  id: string;
  onClose: () => void;
  onResolved: () => void;
  accounts: Account[];
}) {
  const { data, error, mutate } = useFetch<ExceptionDetail>(`/api/finance/exceptions/${id}`);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const proposal = data?.exception.proposed_action ?? null;
  const proposedCode = proposal?.categorize?.accountCode ?? null;

  async function act(action: "approve" | "dismiss" | "correct") {
    setBusy(true);
    setErrMsg(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "correct") {
        if (!override) {
          setErrMsg("Pick an account code first");
          setBusy(false);
          return;
        }
        body.accountCode = override;
      }
      if (action === "dismiss") body.reason = "dismissed via inbox";
      const res = await fetch(`/api/finance/exceptions/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrMsg(j.error ?? `Failed (${res.status})`);
      } else if (j.result?.kind === "noop") {
        setErrMsg(j.result.reason);
      } else {
        await mutate();
        onResolved();
        onClose();
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button className="flex-1 bg-black/40" onClick={onClose} aria-label="Close drawer" />
      <aside className="w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Resolve exception</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>

        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {error && <div className="text-sm text-rose-500">Failed to load.</div>}

        {data && (
          <div className="space-y-5">
            <section>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Reason</div>
              <div className="mt-1 text-sm">{data.exception.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                <Bot className="mr-1 inline h-3 w-3" />
                {data.exception.agent} · {data.exception.type}
              </div>
            </section>

            {proposal?.bill && (
              <section className="rounded-md border p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Parsed bill
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Supplier</dt>
                  <dd>{proposal.supplierName ?? proposal.bill.supplierName ?? "—"}</dd>
                  <dt className="text-muted-foreground">Bill #</dt>
                  <dd>{proposal.bill.billNumber ?? "—"}</dd>
                  <dt className="text-muted-foreground">Date</dt>
                  <dd>{proposal.bill.billDate ?? "—"}</dd>
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{proposal.bill.dueDate ?? "—"}</dd>
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{RM(proposal.bill.subtotal)}</dd>
                  <dt className="text-muted-foreground">SST</dt>
                  <dd className="tabular-nums">{RM(proposal.bill.sst)}</dd>
                  <dt className="text-muted-foreground">Total</dt>
                  <dd className="tabular-nums font-medium">{RM(proposal.bill.total)}</dd>
                </dl>
                {proposal.bill.rawWarnings && proposal.bill.rawWarnings.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {proposal.bill.rawWarnings.join("; ")}
                  </div>
                )}
              </section>
            )}

            {proposal?.categorize && (
              <section className="rounded-md border p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Agent suggestion
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-muted px-2 py-1 text-sm font-medium">
                    {proposedCode ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(proposal.categorize.confidence * 100)}% confident
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {proposal.categorize.reasoning}
                </div>
                {proposal.categorize.alternativeCodes && proposal.categorize.alternativeCodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {proposal.categorize.alternativeCodes.map((c) => (
                      <button
                        key={c}
                        onClick={() => setOverride(c)}
                        className={`rounded-md border px-2 py-0.5 text-xs hover:border-foreground/40 ${
                          override === c ? "border-foreground" : ""
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Source doc preview */}
            {data.document?.signed_url && (
              <section className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-3 w-3" /> Source document
                </div>
                {data.document.metadata?.mimeType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.document.signed_url} alt="bill" className="max-h-96 rounded border" />
                ) : (
                  <a
                    href={data.document.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Open PDF →
                  </a>
                )}
              </section>
            )}

            {/* Action panel */}
            <section className="space-y-3 rounded-md border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Or pick a different account
              </div>
              <select
                value={override ?? ""}
                onChange={(e) => setOverride(e.target.value || null)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— keep agent suggestion —</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              {errMsg && <div className="text-xs text-rose-500">{errMsg}</div>}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => act(override ? "correct" : "approve")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {override ? "Post with override" : "Approve & post"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => act("dismiss")}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Dismiss
                </button>
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function FinanceInboxPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const exc = useFetch<{ exceptions: ExceptionRow[] }>("/api/finance/exceptions?status=open");
  const acc = useFetch<{ accounts: Account[] }>("/api/finance/accounts?types=expense,cogs,asset");

  const accountOptions = useMemo(() => acc.data?.accounts ?? [], [acc.data]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Items the agents couldn't resolve. Approve, correct, or dismiss — every
          decision trains the categorizer.
        </p>
      </header>

      <UploadZone onUploaded={() => exc.mutate()} />

      {exc.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {exc.error && <div className="text-sm text-rose-500">Failed to load: {String(exc.error)}</div>}

      {exc.data && exc.data.exceptions.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Nothing in the inbox. The agents are caught up.
        </div>
      )}

      {exc.data && exc.data.exceptions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {exc.data.exceptions.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-t hover:bg-muted/30"
                  onClick={() => setOpenId(e.id)}
                >
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                        PRIORITY_COLOR[e.priority]
                      }`}
                    >
                      {e.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2">{e.reason}</td>
                  <td className="px-3 py-2">
                    {e.proposed_action?.supplierName ?? e.proposed_action?.bill?.supplierName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {RM(e.proposed_action?.bill?.total ?? null)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.agent} · {e.type}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("en-MY")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && (
        <Drawer
          id={openId}
          onClose={() => setOpenId(null)}
          onResolved={() => exc.mutate()}
          accounts={accountOptions}
        />
      )}
    </div>
  );
}
