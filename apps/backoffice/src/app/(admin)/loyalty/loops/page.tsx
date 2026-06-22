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
  CheckCircle2, AlertTriangle, Trophy, Users, ShieldOff, Coins, Plus, X, Crown, Sparkles, Clock, BarChart3,
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
  scheduled_send_at: string | null; send_window: string | null;
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
type LoopMeta = { key: string; label: string; objective: string; defaultHoldoutPct: number; defaultWindowDays: number; triggered?: boolean };
type SendTimeEntry = { send_window: string; rounds: number; recipients: number; avg_lift_pp: number; avg_order_rate: number };
type Optimizer = {
  loop_key: string; leaderboard: LeaderboardEntry[]; proposal: { arms: ProposalArm[] };
  candidates: Candidate[]; loops: LoopMeta[];
  send_time_leaderboard: SendTimeEntry[]; send_window_proposal: { window: string; reason: string }; send_windows: string[];
};
type LoopEval = {
  loop_key: string; label: string; rounds: number; sent: number;
  redemptions: number; redemption_rate: number; avg_lift_pp: number;
  incremental_orders: number; incremental_margin_rm: number; sms_cost_rm: number; roi: number;
};
type LiveLoop = {
  loop_key: string; label: string; rounds: number; in_flight: number;
  sent: number; vouchers: number; redeemed: number; orders: number; revenue_rm: number;
  sms_cost_rm: number; redeemed_rate: number; next_results_at: string | null;
};
type Evaluation = {
  per_loop: LoopEval[]; totals: Omit<LoopEval, "loop_key" | "label">;
  live: { per_loop: LiveLoop[]; totals: Omit<LiveLoop, "loop_key" | "label"> };
};

const CHAMPION_MIN_RECIPIENTS = 300;

// ---- helpers ----------------------------------------------------------------
function rm(n: number) {
  return `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// SMS segment counter. The gateway prepends "RM0 CELSIUSCOFFEE: ", so the
// recipient sees prefix+body. 1 segment = ≤160 GSM-7 chars; a single non-GSM
// char (em-dash, smart quote, emoji) flips the whole message to UCS-2 (≤70).
// Every loop SMS must stay 1 segment so cost is predictable.
const SMS_PREFIX = "RM0 CELSIUSCOFFEE: ";
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[]~|€";
function smsSegments(body: string): { chars: number; segments: number; gsm7: boolean } {
  const text = SMS_PREFIX + body;
  let gsm7 = true, units = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { gsm7 = false; break; }
  }
  if (!gsm7) {
    const cu = [...text].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
    return { chars: cu, segments: cu <= 70 ? 1 : Math.ceil(cu / 67), gsm7: false };
  }
  return { chars: units, segments: units <= 160 ? 1 : Math.ceil(units / 153), gsm7: true };
}
function windowLabel(w: string | null | undefined): string {
  if (!w) return "—";
  return w.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}
function defaultLocalDatetime(): string {
  const d = new Date(Date.now() + 3600000); // ~1h from now
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [evalData, setEvalData] = useState<Evaluation | null>(null);
  const [evalDays, setEvalDays] = useState<number | null>(null); // null = all-time
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastPreview, setLastPreview] = useState<Preview | null>(null);
  const [loopKey, setLoopKey] = useState("winback");
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = `?loop_key=${encodeURIComponent(loopKey)}`;
      const [rRes, oRes] = await Promise.all([
        fetch(`/api/loyalty/loops${qs}`),
        fetch(`/api/loyalty/loops/optimizer${qs}`),
      ]);
      if (!rRes.ok) throw new Error(`list failed (${rRes.status})`);
      setRounds((await rRes.json()) as Round[]);
      if (oRes.ok) setOpt((await oRes.json()) as Optimizer);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [loopKey]);
  useEffect(() => { setRounds(null); setOpt(null); setLastPreview(null); void load(); }, [load]);

  // Scorecard rollup is fetched separately so the date filter only refetches it.
  const loadEval = useCallback(async () => {
    try {
      const res = await fetch(`/api/loyalty/loops/summary${evalDays ? `?since_days=${evalDays}` : ""}`);
      if (res.ok) setEvalData((await res.json()) as Evaluation);
    } catch { /* non-fatal */ }
  }, [evalDays]);
  useEffect(() => { void loadEval(); }, [loadEval]);

  // Realtime: silently refetch the scorecard + rounds every 20s while the tab is
  // visible, so the dashboard stays live without a manual refresh (rounds flip to
  // measured / scorecard fills in on their own). Skipped while hidden or busy.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void load();
      void loadEval();
    };
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, [load, loadEval]);

  // Auto-triggered loops run themselves — no manual "New round" form, no budget.
  const activeTriggered = !!opt?.loops.find((l) => l.key === loopKey)?.triggered;

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
        Every campaign is a loop: the engine proposes each round&apos;s offers against a holdout and learns which logic wins — the setup sharpens over time. Pick an objective:
      </p>

      {evalData && <EvaluationPanel data={evalData} days={evalDays} onDays={setEvalDays} loops={opt?.loops ?? []} />}

      {/* Fire all auto-triggered loops on demand (first run / catch-up). They
          also run themselves daily at 9am; this is for an immediate send. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <button
          disabled={busy === "run"}
          onClick={async () => {
            if (!confirm("Fire all auto-triggered loops NOW? This sends LIVE SMS to everyone who currently qualifies (Reactivation / Welcome / Birthday).")) return;
            setBusy("run"); setErr(null); setRunResult(null);
            try {
              const res = await fetch("/api/loyalty/loops/run-triggered", { method: "POST" });
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error ?? "Run failed");
              const fired = ((data.triggered ?? []) as Array<{ loop: string; sent?: number; failed?: number; error?: string; skipped?: boolean }>).map((t) => t.skipped ? `${t.loop}: already ran today` : `${t.loop}: ${t.sent ?? 0} sent${t.failed ? `, ${t.failed} failed` : ""}${t.error ? ` (${t.error})` : ""}`).join(" · ");
              setRunResult(fired || "Nothing qualified right now.");
              await load();
            } catch (e) { setErr(e instanceof Error ? e.message : "Run failed"); }
            finally { setBusy(null); }
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#A2492C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Run all triggered loops now
        </button>
        <span className="text-xs text-gray-500">{runResult ?? "Fires Reactivation + Welcome + Birthday immediately. They also run automatically at 9am daily."}</span>
      </div>

      {opt && (
        <div className="mb-4 flex flex-wrap gap-2">
          {opt.loops.map((l) => (
            <button
              key={l.key}
              onClick={() => setLoopKey(l.key)}
              title={l.objective}
              className={cn("rounded-full border px-3 py-1.5 text-sm", loopKey === l.key ? "border-[#A2492C] bg-[#A2492C] text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300")}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {opt?.loops.find((l) => l.key === loopKey)?.triggered && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <Repeat className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            <strong>Auto-triggered daily.</strong> This loop fires by itself — it auto-issues the voucher + SMS to each new qualifier (birthday today · ~1 day after a 1st visit · just lapsed), no budget or approval. Nothing to do here — just watch the scorecard and rounds below.
          </span>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        {!activeTriggered && <span><span className="text-gray-500">SMS budget</span> <strong>set per round</strong> (start {rm(DEFAULT_BUDGET_RM)}, scale up)</span>}
        <span><span className="text-gray-500">Scale an arm at</span> <strong>≥{SUCCESS_BAR_PP}pp lift</strong> vs holdout</span>
        <span><span className="text-gray-500">Margin read at</span> <strong>{Math.round(GP * 100)}% GP</strong></span>
        <span><span className="text-gray-500">SMS</span> <strong>{rm(SMS_COST_RM)}</strong>/msg · rewards self-funding (need a paid order)</span>
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {err}
        </div>
      )}

      {opt && <MessagesPanel arms={opt.proposal.arms} />}

      {opt && <OptimizerPanel opt={opt} />}

      {!activeTriggered && (opt ? (
        <NewRoundCard
          key={loopKey}
          loopKey={loopKey}
          loopMeta={opt.loops.find((l) => l.key === loopKey)}
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
      ))}

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

      {activeTriggered ? (
        <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">This loop runs automatically — every send and its results roll up into the <strong>live scoreboard</strong> at the top of the page. Nothing to manage here.</p>
      ) : (<>
      <h2 className="mb-3 mt-2 text-lg font-semibold">Rounds</h2>
      {rounds === null ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">{activeTriggered ? "No rounds yet — this loop runs automatically; rounds appear here after the next daily run (~9am)." : "No rounds yet — configure one above."}</div>
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
              onSchedule={async (scheduledSendAt, sendWindow) => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id, scheduled_send_at: scheduledSendAt, send_window: sendWindow }) });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error ?? "Schedule failed");
                  await load();
                } catch (e) { setErr(e instanceof Error ? e.message : "Schedule failed"); }
                finally { setBusy(null); }
              }}
              onCancel={async () => {
                setBusy(r.id); setErr(null);
                try {
                  const res = await fetch("/api/loyalty/loops/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round_id: r.id }) });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error ?? "Cancel failed");
                  await load();
                } catch (e) { setErr(e instanceof Error ? e.message : "Cancel failed"); }
                finally { setBusy(null); }
              }}
              proposedWindow={opt?.send_window_proposal?.window}
              windows={opt?.send_windows ?? []}
              triggered={activeTriggered}
            />
          ))}
        </div>
      )}
      </>)}

      <button onClick={() => void load()} className="mt-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </button>
    </div>
  );
}

// ---- Evaluation overview: cross-loop scorecard ------------------------------
function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-[#A2492C]/30 bg-[#A2492C]/5" : "border-gray-200 bg-gray-50")}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
const EVAL_PRESETS: Array<{ label: string; val: number | null }> = [
  { label: "7d", val: 7 }, { label: "30d", val: 30 }, { label: "90d", val: 90 }, { label: "All", val: null },
];
function EvaluationPanel({ data, days, onDays, loops }: { data: Evaluation; days: number | null; onDays: (d: number | null) => void; loops: LoopMeta[] }) {
  const lv = data.live.totals;
  const liveByKey = new Map(data.live.per_loop.map((l) => [l.loop_key, l]));
  const measByKey = new Map(data.per_loop.map((l) => [l.loop_key, l]));
  // One board per campaign — driven off the loops list so idle campaigns
  // (e.g. Birthday before it fires today) still show a board.
  const campaigns = loops.length
    ? loops.map((l) => ({ key: l.key, label: l.label, objective: l.objective, triggered: l.triggered }))
    : data.live.per_loop.map((l) => ({ key: l.loop_key, label: l.label, objective: "", triggered: false }));
  const totalReturn = lv.sms_cost_rm > 0 ? `${(lv.revenue_rm / lv.sms_cost_rm).toFixed(1)}×` : "—";
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-[#A2492C]" />
        <h2 className="text-lg font-semibold">Campaign scorecards</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700" title="Auto-updates every 20s">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
          </span>
          Live
        </span>
        {days ? <span className="text-xs text-gray-400">last {days}d</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {EVAL_PRESETS.map((p) => (
            <button key={p.label} onClick={() => onDays(p.val)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", days === p.val ? "bg-[#A2492C] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* All-campaigns total */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">All campaigns</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label="SMS sent" value={lv.sent.toLocaleString()} sub={`${rm(lv.sms_cost_rm)} spent`} />
          <Kpi label="Redeemed" value={lv.redeemed.toLocaleString()} sub={`${lv.redeemed_rate}%`} />
          <Kpi label="Orders" value={lv.orders.toLocaleString()} sub="so far" />
          <Kpi label="RM Orders" value={rm(lv.revenue_rm)} sub="gross · in window" />
          <Kpi label="Return" value={totalReturn} sub="RM per RM1 SMS" highlight />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Orders, RM &amp; return are <strong>gross attributed so far</strong>. True ROI vs the holdout shows per campaign once each window closes.</p>
      </div>

      {/* One board per campaign */}
      <div className="grid gap-3 md:grid-cols-2">
        {campaigns.map((c) => (
          <CampaignBoard key={c.key} meta={c} live={liveByKey.get(c.key) ?? null} meas={measByKey.get(c.key) ?? null} />
        ))}
      </div>
    </div>
  );
}

function CampaignBoard({ meta, live, meas }: {
  meta: { key: string; label: string; objective: string; triggered?: boolean };
  live: LiveLoop | null; meas: LoopEval | null;
}) {
  const sent = live?.sent ?? 0;
  const measuring = (live?.in_flight ?? 0) > 0;
  const hasResults = !!meas && meas.rounds > 0;
  const next = live?.next_results_at ? new Date(live.next_results_at).toLocaleDateString("en-MY", { day: "numeric", month: "short" }) : null;
  const ret = live && live.sms_cost_rm > 0 ? `${(live.revenue_rm / live.sms_cost_rm).toFixed(1)}×` : "—";
  const status = measuring ? { t: "Measuring", c: "bg-blue-100 text-blue-800" }
    : hasResults ? { t: "Measured", c: "bg-green-100 text-green-800" }
    : sent > 0 ? { t: "Sent", c: "bg-gray-100 text-gray-600" }
    : { t: "Idle", c: "bg-gray-100 text-gray-400" };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{meta.label}</h3>
          {meta.objective && <p className="truncate text-xs text-gray-400">{meta.objective}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", status.c)}>{status.t}</span>
      </div>
      {sent === 0 ? (
        <p className="mt-3 text-sm text-gray-400">{meta.triggered ? "Runs automatically — fires when customers qualify." : "No sends yet."}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
            <MiniStat label="Sent" value={sent.toLocaleString()} />
            <MiniStat label="Redeemed" value={`${live!.redeemed} (${live!.redeemed_rate}%)`} />
            <MiniStat label="Orders" value={live!.orders.toLocaleString()} />
            <MiniStat label="RM Orders" value={rm(live!.revenue_rm)} />
            <MiniStat label="Return" value={ret} />
            <MiniStat label="Spent" value={rm(live!.sms_cost_rm)} />
          </div>
          {hasResults ? (
            <div className="mt-3 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-900"><strong>Results:</strong> ROI {meas!.roi > 0 ? `${meas!.roi}×` : "—"} · {meas!.avg_lift_pp > 0 ? "+" : ""}{meas!.avg_lift_pp}pp lift · {rm(meas!.incremental_margin_rm)} incr. margin</div>
          ) : measuring && next ? (
            <p className="mt-2 text-xs text-blue-700">Measuring — results vs holdout from {next}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

// ---- Messages panel: the actual SMS copy each customer receives -------------
function MessagesPanel({ arms }: { arms: ProposalArm[] }) {
  if (!arms.length) return null;
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Send className="h-5 w-5 text-[#A2492C]" />
        <h2 className="text-lg font-semibold">Messages going out</h2>
        <span className="text-xs text-gray-400">exactly what each customer receives · {arms.length} in rotation</span>
      </div>
      <div className="space-y-3">
        {arms.map((a) => {
          const seg = smsSegments(a.message);
          return (
            <div key={a.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <RoleBadge role={a.role} />
                <span className="text-sm font-medium">{a.label}</span>
              </div>
              <p className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{SMS_PREFIX}{a.message}</p>
              <p className="mt-1 text-[11px] text-gray-400">{seg.chars}/{seg.gsm7 ? 160 : 70} chars · {seg.segments} SMS{a.reason ? ` · ${a.reason}` : ""}</p>
            </div>
          );
        })}
      </div>
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

      {/* Send-time learning — best window + per-window lift (unknown #3). */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-[#A2492C]" />
          <span className="font-medium">Best send time</span>
          <span className="text-gray-500">— {windowLabel(opt.send_window_proposal?.window)}. {opt.send_window_proposal?.reason}</span>
        </div>
        {opt.send_time_leaderboard.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {opt.send_time_leaderboard.map((s) => (
              <span key={s.send_window} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {windowLabel(s.send_window)}: {s.avg_lift_pp >= 0 ? "+" : ""}{s.avg_lift_pp}pp ({s.recipients.toLocaleString()})
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- New round (seeded by the optimizer's proposal) -------------------------
type FormArm = { key: string; label: string; voucher_template_id: string; message: string; role: "champion" | "challenger"; reason: string };

function NewRoundCard({ loopKey, loopMeta, proposal, candidates, busy, onPrepare }: {
  loopKey: string; loopMeta?: LoopMeta; proposal: ProposalArm[]; candidates: Candidate[]; busy: boolean; onPrepare: (p: unknown) => void;
}) {
  const [minD, setMinD] = useState(30);
  const [maxD, setMaxD] = useState(60);
  const [joinedD, setJoinedD] = useState(30);
  const [bdayD, setBdayD] = useState(14);
  const [outletId, setOutletId] = useState("");
  const [activeD, setActiveD] = useState(45);
  const [holdout, setHoldout] = useState(loopMeta?.defaultHoldoutPct ?? 20);
  const [windowD, setWindowD] = useState(loopMeta?.defaultWindowDays ?? 7);
  const [budget, setBudget] = useState(DEFAULT_BUDGET_RM);
  const [arms, setArms] = useState<FormArm[]>(proposal.map((a) => ({ ...a })));

  const logicOf = (tid: string) => candidates.find((c) => c.voucher_template_id === tid)?.logic ?? "—";
  const triggered = !!loopMeta?.triggered; // auto loops have no budget cap
  const anyOverLimit = arms.some((a) => smsSegments(a.message).segments > 1); // block >1-segment sends
  const maxSms = Math.max(0, Math.floor(budget / SMS_COST_RM));
  const maxRecipients = Math.floor(maxSms / Math.max(0.01, 1 - holdout / 100));
  const segmentOpts = (): Record<string, unknown> => {
    switch (loopKey) {
      case "welcome": return { joinedWithinDays: joinedD };
      case "birthday": return { birthdayWithinDays: bdayD };
      case "round_gap": return { outletId, activeWithinDays: activeD };
      default: return { minDaysLapsed: minD, maxDaysLapsed: maxD };
    }
  };

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
        {loopKey === "winback" && (<>
          <Field label="Lapsed from (days)"><NumInput v={minD} set={setMinD} /></Field>
          <Field label="Lapsed to (days)"><NumInput v={maxD} set={setMaxD} /></Field>
        </>)}
        {loopKey === "welcome" && <Field label="Joined within (days)"><NumInput v={joinedD} set={setJoinedD} /></Field>}
        {loopKey === "birthday" && <Field label="Birthday within (days)"><NumInput v={bdayD} set={setBdayD} /></Field>}
        {loopKey === "round_gap" && (<>
          <Field label="Outlet ID"><input value={outletId} onChange={(e) => setOutletId(e.target.value)} placeholder="outlet uuid" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" /></Field>
          <Field label="Active within (days)"><NumInput v={activeD} set={setActiveD} /></Field>
        </>)}
        <Field label="Holdout %"><NumInput v={holdout} set={setHoldout} /></Field>
        <Field label="Attribution window (days)"><NumInput v={windowD} set={setWindowD} /></Field>
        {!triggered && <Field label="SMS budget (RM)"><NumInput v={budget} set={setBudget} /></Field>}
      </div>
      {triggered ? (
        <p className="mb-4 text-xs text-gray-500">
          Auto-triggered loop — sends to everyone who qualifies, no budget cap. A manual round here does the same.
        </p>
      ) : (
        <p className="mb-4 text-xs text-gray-500">
          Budget {rm(budget)} → up to <strong>{maxSms.toLocaleString()}</strong> SMS (~{maxRecipients.toLocaleString()} reached incl. holdout). Caps the round if the segment is larger. Scale later by raising the budget.
        </p>
      )}

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
            {(() => {
              const s = smsSegments(a.message);
              return (
                <p className={cn("mt-1 text-xs", s.segments > 1 ? "font-medium text-red-600" : "text-gray-400")}>
                  {s.chars}/{s.gsm7 ? 160 : 70} incl. sender · {s.segments === 1 ? "1 SMS" : `${s.segments} SMS — shorten to fit 1`}{!s.gsm7 && " · non-GSM char (halves the limit)"}
                </p>
              );
            })()}
          </div>
        ))}
      </div>

      {anyOverLimit && (
        <p className="mb-2 text-xs font-medium text-red-600">One or more messages exceed a single SMS — shorten them before preparing (keeps cost at 1 SMS each).</p>
      )}
      <button
        disabled={busy || arms.length === 0 || anyOverLimit}
        onClick={() => onPrepare({
          loop_key: loopKey,
          arms: arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message })),
          holdoutPct: holdout, attributionWindowDays: windowD, maxRecipients: triggered ? undefined : maxRecipients,
          segment: segmentOpts(),
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
function RoundCard({ round, busy, onSend, onMeasure, onSchedule, onCancel, proposedWindow, windows, triggered }: {
  round: Round; busy: boolean; onSend: () => void; onMeasure: () => void;
  onSchedule: (scheduledSendAt: string, sendWindow: string) => void; onCancel: () => void; proposedWindow?: string; windows: string[]; triggered?: boolean;
}) {
  const est = estSmsCost(round);
  const [when, setWhen] = useState(() => defaultLocalDatetime());
  const [win, setWin] = useState(proposedWindow ?? "weekday_evening");
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

          {round.scheduled_send_at && (
            <div className="mb-2 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
              <Clock className="h-3.5 w-3.5" /> Scheduled for {new Date(round.scheduled_send_at).toLocaleString("en-MY")} ({windowLabel(round.send_window)}) — the cron fires it automatically.
            </div>
          )}

          {/* Schedule: approve now, engine fires at the chosen window. */}
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-600">Send at
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 block rounded-md border border-gray-200 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-600">Window
              <select value={win} onChange={(e) => setWin(e.target.value)} className="mt-1 block rounded-md border border-gray-200 px-2 py-1 text-sm">
                {windows.map((w) => <option key={w} value={w}>{windowLabel(w)}</option>)}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => onSchedule(new Date(when).toISOString(), win)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#A2492C] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} {round.scheduled_send_at ? "Reschedule" : "Schedule send"}
            </button>
          </div>
          {proposedWindow && <p className="mb-2 text-xs text-gray-500">Engine suggests <strong>{windowLabel(proposedWindow)}</strong> as the best-known window.</p>}

          <button
            disabled={busy}
            onClick={() => { if (confirm(`Send SMS NOW for round ${round.round_no}? Fires ${est != null ? `~${rm(est)} of` : ""} live SMS immediately.`)) onSend(); }}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send now
          </button>
          <button
            disabled={busy}
            onClick={() => { if (confirm(`Cancel round ${round.round_no}? This deletes the un-sent vouchers + the round. No SMS has gone out.`)) onCancel(); }}
            className="ml-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" /> Cancel round
          </button>
        </div>
      )}

      {round.status === "sent" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          {triggered ? (
            <div className="text-sm text-blue-900">SMS sent{round.sent_at ? ` ${new Date(round.sent_at).toLocaleDateString("en-MY")}` : ""}. <strong>Auto-measures</strong> when the {round.attribution_window_days}-day window closes — nothing to do.</div>
          ) : (
            <>
              <div className="mb-2 text-sm text-blue-900">SMS sent{round.sent_at ? ` ${new Date(round.sent_at).toLocaleDateString("en-MY")}` : ""}. Auto-measures when the {round.attribution_window_days}-day window closes, or measure now:</div>
              <button disabled={busy} onClick={onMeasure} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Measure results
              </button>
            </>
          )}
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
