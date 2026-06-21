"use client";

// ============================================================================
// Win-back SMS loop — operator + monitor dashboard.
//
// Drives the loop-engine routes end to end:
//   configure → POST /prepare (segment + 20% holdout + auto-issue vouchers)
//             → review → POST /send (fire SMS per arm) → wait window
//             → POST /measure (per-arm conversion + lift vs holdout)
//
// Agreed economics (round 1): SMS budget RM400/round, scale an arm only at
// >=3pp order-rate lift over the holdout, margins read at 72% GP.
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Repeat, RefreshCw, Send, FlaskConical, Loader2,
  CheckCircle2, AlertTriangle, Trophy, Users, ShieldOff, Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---- agreed knobs -----------------------------------------------------------
const BUDGET_PER_ROUND_RM = 400;
const SUCCESS_BAR_PP = 3;
const SMS_COST_RM = 0.1;
const GP = 0.72; // gross-profit rate for margin read

// ---- arm presets (existing voucher_templates) -------------------------------
type ArmPreset = {
  key: string;
  label: string;
  logic: string;
  voucher_template_id: string;
  message: string;
  on: boolean;
};
const ARM_PRESETS: ArmPreset[] = [
  {
    key: "pct15", label: "15% off RM40+", logic: "% discount",
    voucher_template_id: "eb47fd73-42ab-4eb6-ade4-a12f96912d00",
    message: "We miss you at Celsius! Enjoy 15% off when you spend RM40+. Tap to use — valid 14 days.",
    on: true,
  },
  {
    key: "flat10", label: "RM10 off RM30+", logic: "flat discount",
    voucher_template_id: "02ca62f1-171d-41d2-b6d6-9ca2d67ca3b9",
    message: "We miss you at Celsius! Here's RM10 off your next RM30+ order. Tap to use — valid 14 days.",
    on: true,
  },
  {
    key: "b1f1", label: "Buy 1 Free 1 drinks", logic: "BOGO",
    voucher_template_id: "ed33eb26-4ead-414d-b1ee-179999a33940",
    message: "We miss you at Celsius! Buy 1 Free 1 on any drink — bring a friend! Valid 30 days.",
    on: true,
  },
];

// ---- types ------------------------------------------------------------------
type ArmStat = {
  arm: string;
  n: number;
  conversion_rate: number;
  redemption_rate: number;
  lift_pp: number;
  revenue_rm: number;
  revenue_per_recipient_rm: number;
};
type RoundArm = { key: string; label: string; voucher_template_id: string; message: string };
type Round = {
  id: string;
  round_no: number;
  loop_key: string;
  segment_label: string;
  holdout_pct: number;
  arms: RoundArm[];
  attribution_window_days: number;
  status: "prepared" | "sent" | "measured";
  stats: ArmStat[] | null;
  prepared_at: string | null;
  sent_at: string | null;
  measured_at: string | null;
};
type Preview = {
  round_id: string;
  round_no: number;
  segment_label: string;
  total: number;
  holdout: number;
  arm_counts: Record<string, number>;
  est_sms_cost_rm: number;
  est_reward_cogs_rm: number;
};

// ---- helpers ----------------------------------------------------------------
function rm(n: number) {
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Parse "Lapsed 30–60d (4413 reachable, 20% holdout)" → reachable count.
function reachableFromLabel(label: string): number | null {
  const m = label.match(/\(([\d,]+)\s+reachable/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}
function estSmsCost(round: Round): number | null {
  const reach = reachableFromLabel(round.segment_label);
  if (reach == null) return null;
  const treatment = Math.round(reach * (1 - round.holdout_pct / 100));
  return +(treatment * SMS_COST_RM).toFixed(2);
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

// ============================================================================
export default function LoopsPage() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // action-in-flight id
  const [lastPreview, setLastPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/loyalty/loops");
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      setRounds((await res.json()) as Round[]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load rounds");
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
        Re-activate lapsed customers, measured honestly against a holdout. Each round A/B tests offer logics and keeps the winner.
      </p>

      {/* agreed economics banner */}
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <span><span className="text-gray-500">SMS budget</span> <strong>{rm(BUDGET_PER_ROUND_RM)}/round</strong></span>
        <span><span className="text-gray-500">Scale an arm at</span> <strong>≥{SUCCESS_BAR_PP}pp lift</strong> vs holdout</span>
        <span><span className="text-gray-500">Margin read at</span> <strong>{Math.round(GP * 100)}% GP</strong></span>
        <span><span className="text-gray-500">SMS</span> <strong>{rm(SMS_COST_RM)}</strong>/msg · rewards self-funding (need a paid order)</span>
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {err}
        </div>
      )}

      <NewRoundCard
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
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Prepare failed");
          } finally { setBusy(null); }
        }}
      />

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
          {lastPreview.est_sms_cost_rm > BUDGET_PER_ROUND_RM && (
            <div className="mt-1 flex items-center gap-1 text-red-700"><AlertTriangle className="h-3.5 w-3.5" /> Over the {rm(BUDGET_PER_ROUND_RM)} budget — narrow the lapsed window before sending.</div>
          )}
        </div>
      )}

      {/* rounds */}
      <h2 className="mb-3 mt-2 text-lg font-semibold">Rounds</h2>
      {rounds === null ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">No rounds yet — configure one above.</div>
      ) : (
        <div className="space-y-4">
          {rounds.map((r) => (
            <RoundCard
              key={r.id}
              round={r}
              busy={busy === r.id}
              onSend={async () => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/send", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error ?? "Send failed");
                  await load();
                } catch (e) { setErr(e instanceof Error ? e.message : "Send failed"); }
                finally { setBusy(null); }
              }}
              onMeasure={async () => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/measure", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id }),
                  });
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

// ---- New round configurator -------------------------------------------------
function NewRoundCard({ busy, onPrepare }: { busy: boolean; onPrepare: (p: unknown) => void }) {
  const [minD, setMinD] = useState(30);
  const [maxD, setMaxD] = useState(60);
  const [holdout, setHoldout] = useState(20);
  const [windowD, setWindowD] = useState(7);
  const [arms, setArms] = useState<ArmPreset[]>(ARM_PRESETS.map((a) => ({ ...a })));

  const activeArms = arms.filter((a) => a.on);

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-[#A2492C]" />
        <h2 className="text-lg font-semibold">New round</h2>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Lapsed from (days)"><NumInput v={minD} set={setMinD} /></Field>
        <Field label="Lapsed to (days)"><NumInput v={maxD} set={setMaxD} /></Field>
        <Field label="Holdout %"><NumInput v={holdout} set={setHoldout} /></Field>
        <Field label="Attribution window (days)"><NumInput v={windowD} set={setWindowD} /></Field>
      </div>

      <div className="mb-2 text-sm font-medium text-gray-700">Offer arms to test ({activeArms.length} on)</div>
      <div className="space-y-2">
        {arms.map((a, i) => (
          <div key={a.key} className={cn("rounded-lg border p-3", a.on ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60")}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox" checked={a.on}
                onChange={(e) => setArms((prev) => prev.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))}
              />
              <span className="font-medium">{a.label}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{a.logic}</span>
            </label>
            {a.on && (
              <textarea
                value={a.message}
                onChange={(e) => setArms((prev) => prev.map((x, j) => j === i ? { ...x, message: e.target.value } : x))}
                rows={2}
                className="mt-2 w-full rounded-md border border-gray-200 p-2 text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <button
        disabled={busy || activeArms.length === 0}
        onClick={() => onPrepare({
          arms: activeArms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message })),
          holdoutPct: holdout, minDaysLapsed: minD, maxDaysLapsed: maxD, attributionWindowDays: windowD,
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
    <input
      type="number" value={v} onChange={(e) => set(Number(e.target.value))}
      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
    />
  );
}

// ---- Round card -------------------------------------------------------------
function RoundCard({ round, busy, onSend, onMeasure }: {
  round: Round; busy: boolean; onSend: () => void; onMeasure: () => void;
}) {
  const est = estSmsCost(round);
  const overBudget = est != null && est > BUDGET_PER_ROUND_RM;

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

      {/* prepared → send */}
      {round.status === "prepared" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-amber-900">
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> vouchers issued, awaiting send</span>
            {est != null && <span>Est. SMS cost: <strong>{rm(est)}</strong> {overBudget && <span className="text-red-700">(over {rm(BUDGET_PER_ROUND_RM)})</span>}</span>}
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

      {/* sent → measure */}
      {round.status === "sent" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="mb-2 text-sm text-blue-900">SMS sent{round.sent_at ? ` ${new Date(round.sent_at).toLocaleDateString("en-MY")}` : ""}. Measure after the {round.attribution_window_days}-day window closes.</div>
          <button
            disabled={busy}
            onClick={onMeasure}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Measure results
          </button>
        </div>
      )}

      {/* measured → results */}
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
    const incrRevPerRecip = s.revenue_per_recipient_rm - baseRevPerRecip;
    const incrRevenue = incrRevPerRecip * s.n;
    const incrMargin = incrRevenue * GP;
    const smsSpend = s.n * SMS_COST_RM;
    const roi = smsSpend > 0 ? incrMargin / smsSpend : 0;
    const meetsBar = s.lift_pp >= SUCCESS_BAR_PP;
    return { ...s, incrMargin, smsSpend, roi, meetsBar };
  });
  // winner = best incremental margin among arms that clear the bar
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
          ? ` Winner: ${labelFor(winnerArm)} — clears the ≥${SUCCESS_BAR_PP}pp bar with the best incremental margin. Scale it next round.`
          : ` No arm cleared the ≥${SUCCESS_BAR_PP}pp bar — hold spend and retest.`}
      </p>
    </div>
  );
}
