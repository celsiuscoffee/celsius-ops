"use client";

// ============================================================================
// Win-back SMS loop — adaptive optimizer + monitor dashboard.
//
// Not a fixed template: the engine proposes each round's arms (champion +
// challengers) from an offer SPACE and a leaderboard built from every past
// round, so the setup gets better over time. Operator approves each send.
//   configure → /prepare (segment + holdout + auto-issue vouchers, no SMS)
//             → review → /send → wait window → /measure → per-arm results
//             → leaderboard updates → next proposal sharpens.
//
// Agreed economics: start RM200/round SMS then scale; scale an arm only at
// >=3pp order-rate lift over the holdout; margins read at 72% GP.
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Repeat, RefreshCw, Send, FlaskConical, Loader2,
  CheckCircle2, AlertTriangle, Trophy, Users, ShieldOff, Coins, Plus, X, Crown, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---- agreed knobs -----------------------------------------------------------
const DEFAULT_BUDGET_RM = 200; // round-1 default; raise to scale
const SUCCESS_BAR_PP = 3;
const SMS_COST_RM = 0.1;
const GP = 0.72;

// ---- types ------------------------------------------------------------------
type ArmStat = {
  arm: string; n: number; conversion_rate: number; redemption_rate: number;
  lift_pp: number; revenue_rm: number; revenue_per_recipient_rm: number;
};
type RoundArm = { key: string; label: string; voucher_template_id: string; message: string };
type Round = {
  id: string; round_no: number; loop_key: string; segment_label: string;
  holdout_pct: number; arms: RoundArm[]; attribution_window_days: number;
  status: "prepared" | "sent" | "measured"; stats: ArmStat[] | null;
  prepared_at: string | null; sent_at: string | null; measured_at: string | null;
};
type Preview = {
  round_id: string; round_no: number; segment_label: string; total: number;
  holdout: number; arm_counts: Record<string, number>; est_sms_cost_rm: number; est_reward_cogs_rm: number;
};
type Candidate = { key: string; label: string; logic: string; voucher_template_id: string; message: string };
type ProposalArm = { key: string; label: string; voucher_template_id: string; message: string; role: "champion" | "challenger"; reason: string };
type LeaderboardEntry = {
  template_id: string; key: string | null; label: string; logic: string | null;
  rounds: number; recipients: number; avg_lift_pp: number;
  incr_margin_per_recipient_rm: number; cum_incr_margin_rm: number;
};
type Optimizer = { leaderboard: LeaderboardEntry[]; proposal: { arms: ProposalArm[] }; candidates: Candidate[] };

const CHAMPION_MIN_RECIPIENTS = 300;

// ---- helpers ----------------------------------------------------------------
function rm(n: number) {
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function reachableFromLabel(label: string): number | null {
  const m = label.match(/\(([\d,]+)\s+reachable/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}
function estSmsCost(round: Round): number | null {
  const reach = reachableFromLabel(round.segment_label);
  if (reach == null) return null;
  return +(Math.round(reach * (1 - round.holdout_pct / 100)) * SMS_COST_RM).toFixed(2);
}
function StatusBadge({ status }: { status: Round["status"] }) {
  const map: Record<Round["status"], { label: string; cls: string }> = {
    prepared: { label: "Prepared — awaiting send", cls: "bg-amber-100 text-amber-800" },
    sent: { label: "Sent — measuring", cls: "bg-blue-100 text-blue-800" },
    measured: { label: "Measured", cls: "bg-green-100 text-green-800" },
  };
  const s = map[status];
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", s.cls)}>{s.label}</span>;
}
function RoleBadge({ role }: { role: "champion" | "challenger" }) {
  return role === "champion" ? (
    <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800"><Crown className="h-3 w-3" /> champion</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800"><Sparkles className="h-3 w-3" /> challenger</span>
  );
}

// ============================================================================
export default function LoopsPage() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [opt, setOpt] = useState<Optimizer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    try {
      const [rRes, oRes] = await Promise.all([
        fetch("/api/loyalty/loops"),
        fetch("/api/loyalty/loops/optimizer"),
      ]);
      if (!rRes.ok) throw new Error(`list failed (${rRes.status})`);
      setRounds((await rRes.json()) as Round[]);
      if (oRes.ok) setOpt((await oRes.json()) as Optimizer);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/loyalty/engage" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Engage
      </Link>

      <div className="mb-1 flex items-center gap-2">
        <Repeat className="h-6 w-6 text-[#A2492C]" />
        <h1 className="text-2xl font-semibold">Win-back loops</h1>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Re-activate lapsed customers, measured honestly against a holdout. The engine proposes each round&apos;s offers and learns which logic wins — the setup sharpens over time.
      </p>

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <span><span className="text-gray-500">SMS budget</span> <strong>set per round</strong> (start {rm(DEFAULT_BUDGET_RM)}, scale up)</span>
        <span><span className="text-gray-500">Scale an arm at</span> <strong>≥{SUCCESS_BAR_PP}pp lift</strong> vs holdout</span>
        <span><span className="text-gray-500">Margin read at</span> <strong>{Math.round(GP * 100)}% GP</strong></span>
        <span><span className="text-gray-500">SMS</span> <strong>{rm(SMS_COST_RM)}</strong>/msg · rewards self-funding (need a paid order)</span>
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {err}
        </div>
      )}

      {opt && <OptimizerPanel opt={opt} />}

      {opt ? (
        <NewRoundCard
          proposal={opt.proposal.arms}
          candidates={opt.candidates}
          busy={busy === "prepare"}
          onPrepare={async (payload) => {
            setBusy("prepare"); setErr(null); setLastPreview(null);
            try {
              const res = await fetch("/api/loyalty/loops/prepare", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error ?? "Prepare failed");
              setLastPreview(data as Preview);
              await load();
            } catch (e) { setErr(e instanceof Error ? e.message : "Prepare failed"); }
            finally { setBusy(null); }
          }}
        />
      ) : (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 shadow-sm">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" /> Loading optimizer…
        </div>
      )}

      {lastPreview && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="mb-1 font-medium">Round {lastPreview.round_no} prepared — {lastPreview.total.toLocaleString()} reachable, vouchers issued. No SMS sent yet.</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Holdout: <strong>{lastPreview.holdout.toLocaleString()}</strong></span>
            {Object.entries(lastPreview.arm_counts).filter(([k]) => k !== "holdout").map(([k, v]) => (
              <span key={k}>{k}: <strong>{v.toLocaleString()}</strong></span>
            ))}
            <span>Est. SMS cost: <strong>{rm(lastPreview.est_sms_cost_rm)}</strong></span>
          </div>
        </div>
      )}

      <h2 className="mb-3 mt-2 text-lg font-semibold">Rounds</h2>
      {rounds === null ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">No rounds yet — configure one above.</div>
      ) : (
        <div className="space-y-4">
          {rounds.map((r) => (
            <RoundCard
              key={r.id} round={r} busy={busy === r.id}
              onSend={async () => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id }) });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error ?? "Send failed");
                  await load();
                } catch (e) { setErr(e instanceof Error ? e.message : "Send failed"); }
                finally { setBusy(null); }
              }}
              onMeasure={async () => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/measure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id }) });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error ?? "Measure failed");
                  await load();
                } catch (e) { setErr(e instanceof Error ? e.message : "Measure failed"); }
                finally { setBusy(null); }
              }}
            />
          ))}
        </div>
      )}

      <button onClick={() => void load()} className="mt-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </button>
    </div>
  );
}

// ---- Optimizer panel: leaderboard + champion --------------------------------
function OptimizerPanel({ opt }: { opt: Optimizer }) {
  const lb = opt.leaderboard;
  const champion = lb.find((e) => e.recipients >= CHAMPION_MIN_RECIPIENTS) ?? null;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-[#A2492C]" />
        <h2 className="text-lg font-semibold">Optimizer</h2>
      </div>

      {lb.length === 0 ? (
        <p className="text-sm text-gray-500">
          No measured rounds yet — the leaderboard fills in after your first round. The engine has proposed a diverse starter set below (one of each logic) to begin exploring.
        </p>
      ) : (
        <>
          {champion ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
              <Crown className="h-4 w-4" /> Champion: <strong>{champion.label}</strong> — {champion.incr_margin_per_recipient_rm >= 0 ? "+" : ""}{rm(champion.incr_margin_per_recipient_rm)}/recipient, {champion.avg_lift_pp >= 0 ? "+" : ""}{champion.avg_lift_pp}pp over {champion.recipients.toLocaleString()} sent.
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Still exploring — no offer has {CHAMPION_MIN_RECIPIENTS}+ recipients yet, so no champion is crowned. Keep running rounds.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3">Offer</th>
                  <th className="py-2 pr-3">Logic</th>
                  <th className="py-2 pr-3 text-right">Rounds</th>
                  <th className="py-2 pr-3 text-right">Sent</th>
                  <th className="py-2 pr-3 text-right">Avg lift</th>
                  <th className="py-2 pr-3 text-right">Incr. margin / recipient</th>
                </tr>
              </thead>
              <tbody>
                {lb.map((e) => (
                  <tr key={e.template_id} className={cn("border-b border-gray-100", champion?.template_id === e.template_id && "bg-green-50")}>
                    <td className="py-2 pr-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {champion?.template_id === e.template_id && <Crown className="h-3.5 w-3.5 text-green-600" />}
                        {e.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{e.logic ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.rounds}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.recipients.toLocaleString()}</td>
                    <td className={cn("py-2 pr-3 text-right tabular-nums", e.avg_lift_pp >= SUCCESS_BAR_PP ? "text-green-700" : e.avg_lift_pp > 0 ? "text-gray-700" : "text-red-600")}>
                      {e.avg_lift_pp > 0 ? "+" : ""}{e.avg_lift_pp}pp
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.incr_margin_per_recipient_rm >= 0 ? "+" : ""}{rm(e.incr_margin_per_recipient_rm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- New round (seeded by the optimizer's proposal) -------------------------
type FormArm = { key: string; label: string; voucher_template_id: string; message: string; role: "champion" | "challenger"; reason: string };

function NewRoundCard({ proposal, candidates, busy, onPrepare }: {
  proposal: ProposalArm[]; candidates: Candidate[]; busy: boolean; onPrepare: (p: unknown) => void;
}) {
  const [minD, setMinD] = useState(30);
  const [maxD, setMaxD] = useState(60);
  const [holdout, setHoldout] = useState(20);
  const [windowD, setWindowD] = useState(7);
  const [budget, setBudget] = useState(DEFAULT_BUDGET_RM);
  const [arms, setArms] = useState<FormArm[]>(proposal.map((a) => ({ ...a })));

  const logicOf = (tid: string) => candidates.find((c) => c.voucher_template_id === tid)?.logic ?? "—";
  const maxSms = Math.max(0, Math.floor(budget / SMS_COST_RM));
  const maxRecipients = Math.floor(maxSms / Math.max(0.01, 1 - holdout / 100));

  const swapArm = (i: number, tid: string) => {
    const c = candidates.find((x) => x.voucher_template_id === tid);
    if (!c) return;
    setArms((prev) => prev.map((a, j) => j === i ? { key: c.key, label: c.label, voucher_template_id: c.voucher_template_id, message: c.message, role: a.role, reason: "Manually selected." } : a));
  };
  const addArm = () => {
    const used = new Set(arms.map((a) => a.voucher_template_id));
    const next = candidates.find((c) => !used.has(c.voucher_template_id));
    if (!next) return;
    setArms((prev) => [...prev, { key: next.key, label: next.label, voucher_template_id: next.voucher_template_id, message: next.message, role: "challenger", reason: "Manually added." }]);
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-[#A2492C]" />
        <h2 className="text-lg font-semibold">New round</h2>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Field label="Lapsed from (days)"><NumInput v={minD} set={setMinD} /></Field>
        <Field label="Lapsed to (days)"><NumInput v={maxD} set={setMaxD} /></Field>
        <Field label="Holdout %"><NumInput v={holdout} set={setHoldout} /></Field>
        <Field label="Attribution window (days)"><NumInput v={windowD} set={setWindowD} /></Field>
        <Field label="SMS budget (RM)"><NumInput v={budget} set={setBudget} /></Field>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Budget {rm(budget)} → up to <strong>{maxSms.toLocaleString()}</strong> SMS (~{maxRecipients.toLocaleString()} reached incl. holdout). Caps the round if the lapsed segment is larger. Scale later by raising the budget.
      </p>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Proposed arms ({arms.length})</span>
        <button onClick={addArm} className="inline-flex items-center gap-1 text-xs text-[#A2492C] hover:underline"><Plus className="h-3.5 w-3.5" /> add arm</button>
      </div>
      <div className="space-y-2">
        {arms.map((a, i) => (
          <div key={`${a.voucher_template_id}-${i}`} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <RoleBadge role={a.role} />
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{logicOf(a.voucher_template_id)}</span>
              <select
                value={a.voucher_template_id}
                onChange={(e) => swapArm(i, e.target.value)}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm"
              >
                {candidates.map((c) => (
                  <option key={c.voucher_template_id} value={c.voucher_template_id}>{c.label} · {c.logic}</option>
                ))}
              </select>
              <button onClick={() => setArms((prev) => prev.filter((_, j) => j !== i))} className="ml-auto text-gray-400 hover:text-red-600" aria-label="remove arm"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-xs text-gray-500">{a.reason}</p>
            <textarea
              value={a.message}
              onChange={(e) => setArms((prev) => prev.map((x, j) => j === i ? { ...x, message: e.target.value } : x))}
              rows={2}
              className="w-full rounded-md border border-gray-200 p-2 text-sm"
            />
          </div>
        ))}
      </div>

      <button
        disabled={busy || arms.length === 0}
        onClick={() => onPrepare({
          arms: arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message })),
          holdoutPct: holdout, minDaysLapsed: minD, maxDaysLapsed: maxD, attributionWindowDays: windowD, maxRecipients,
        })}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#A2492C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
        Prepare round (issues vouchers, no SMS)
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
function NumInput({ v, set }: { v: number; set: (n: number) => void }) {
  return (
    <input type="number" value={v} onChange={(e) => set(Number(e.target.value))} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
  );
}

// ---- Round card -------------------------------------------------------------
function RoundCard({ round, busy, onSend, onMeasure }: {
  round: Round; busy: boolean; onSend: () => void; onMeasure: () => void;
}) {
  const est = estSmsCost(round);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Round {round.round_no}</span>
          <StatusBadge status={round.status} />
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1"><ShieldOff className="h-3.5 w-3.5" /> {round.holdout_pct}% holdout</span>
          <span>· {round.attribution_window_days}d window</span>
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-600">{round.segment_label}</div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {round.arms?.map((a) => (
          <span key={a.key} className="rounded-full bg-[#A2492C]/10 px-2.5 py-0.5 text-xs text-[#A2492C]">{a.label}</span>
        ))}
      </div>

      {round.status === "prepared" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-amber-900">
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> vouchers issued, awaiting send</span>
            {est != null && <span>Est. SMS cost: <strong>{rm(est)}</strong></span>}
          </div>
          <button
            disabled={busy}
            onClick={() => { if (confirm(`Send SMS for round ${round.round_no}? This fires ${est != null ? `~${rm(est)} of` : ""} live SMS to all treatment arms.`)) onSend(); }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Approve &amp; send SMS
          </button>
        </div>
      )}

      {round.status === "sent" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="mb-2 text-sm text-blue-900">SMS sent{round.sent_at ? ` ${new Date(round.sent_at).toLocaleDateString("en-MY")}` : ""}. Measure after the {round.attribution_window_days}-day window closes.</div>
          <button disabled={busy} onClick={onMeasure} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Measure results
          </button>
        </div>
      )}

      {round.status === "measured" && round.stats && <Results round={round} />}
    </div>
  );
}

// ---- Results table + ROI ----------------------------------------------------
function Results({ round }: { round: Round }) {
  const stats = round.stats ?? [];
  const holdout = stats.find((s) => s.arm === "holdout");
  const baseRevPerRecip = holdout?.revenue_per_recipient_rm ?? 0;
  const labelFor = (key: string) => round.arms?.find((a) => a.key === key)?.label ?? key;

  const treatment = stats.filter((s) => s.arm !== "holdout").map((s) => {
    const incrMargin = (s.revenue_per_recipient_rm - baseRevPerRecip) * s.n * GP;
    const smsSpend = s.n * SMS_COST_RM;
    const roi = smsSpend > 0 ? incrMargin / smsSpend : 0;
    const meetsBar = s.lift_pp >= SUCCESS_BAR_PP;
    return { ...s, incrMargin, smsSpend, roi, meetsBar };
  });
  const winners = treatment.filter((t) => t.meetsBar).sort((a, b) => b.incrMargin - a.incrMargin);
  const winnerArm = winners[0]?.arm ?? null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <Coins className="h-4 w-4" /> Holdout order rate <strong className="text-gray-800">{holdout?.conversion_rate ?? 0}%</strong> — the baseline every arm is judged against.
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3">Arm</th>
              <th className="py-2 pr-3 text-right">Sent</th>
              <th className="py-2 pr-3 text-right">Order rate</th>
              <th className="py-2 pr-3 text-right">Lift vs holdout</th>
              <th className="py-2 pr-3 text-right">Redeemed</th>
              <th className="py-2 pr-3 text-right">Incr. margin</th>
              <th className="py-2 pr-3 text-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {treatment.map((t) => (
              <tr key={t.arm} className={cn("border-b border-gray-100", t.arm === winnerArm && "bg-green-50")}>
                <td className="py-2 pr-3 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {t.arm === winnerArm && <Trophy className="h-3.5 w-3.5 text-green-600" />}
                    {labelFor(t.arm)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.n.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.conversion_rate}%</td>
                <td className={cn("py-2 pr-3 text-right font-medium tabular-nums", t.lift_pp >= SUCCESS_BAR_PP ? "text-green-700" : t.lift_pp > 0 ? "text-gray-700" : "text-red-600")}>
                  {t.lift_pp > 0 ? "+" : ""}{t.lift_pp}pp {t.meetsBar && "✓"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.redemption_rate}%</td>
                <td className="py-2 pr-3 text-right tabular-nums">{rm(t.incrMargin)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{t.roi > 0 ? `${t.roi.toFixed(1)}×` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Incremental margin = (arm revenue/recipient − holdout revenue/recipient) × recipients × {Math.round(GP * 100)}% GP. ROI = incremental margin ÷ SMS spend.
        {winnerArm
          ? ` Round winner: ${labelFor(winnerArm)}. It feeds the leaderboard — if it leads with enough evidence it becomes the champion next round.`
          : ` No arm cleared the ≥${SUCCESS_BAR_PP}pp bar this round — the optimizer keeps exploring.`}
      </p>
    </div>
  );
}
