"use client";

import { formatRM } from "@celsius/shared";

/**
 * Staff Order Management — optimised for Sunmi V3 (Android touch POS).
 *
 * Layout: PREPARING (oldest first) on top, READY FOR COLLECTION below.
 * Per-card count-up timer + urgency strip (green ≤3m, amber 3-7m, red >7m).
 * Auto-prints 80mm kitchen slip when a new order arrives.
 * Header pulses red OVERDUE chip when any preparing order >7m; tap to snooze 60s.
 * Audio re-chime every 30s while overdue exists; mute toggle persists.
 * Staff taps "Ready" → customer push. "Collected" → archive. Undo Ready supported.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Wifi, Printer, Receipt, X, CheckCircle, Package, Loader2, Pause, Play, RotateCcw, Bell, BellOff } from "lucide-react";
import { printKitchenSlip, printReceipt } from "@/lib/thermal-print";
import { hasSunmiPrinter } from "@/lib/sunmi-printer";
import { isCapacitorNative, nativePrintKitchenSlip, nativePrintReceipt } from "@/lib/sunmi-native";
import { getSession } from "@/lib/staff-auth";
import { StaffNav } from "@/components/staff-nav";
import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

// KDS polls server-side endpoints (service-role) instead of reading the
// orders table directly with the anon key. Customer PII (phone, name,
// order history) stays out of the public bundle — anon SELECT is revoked
// on `orders` + `order_items`. See /api/staff/orders/feed + overdue-count.
const POLL_INTERVAL_MS = 3_000;

// SLA thresholds — used by both card visuals and the overdue escalation.
const PREP_GREEN_MAX_MIN = 3;
const PREP_AMBER_MAX_MIN = 7;
const READY_GREEN_MAX_MIN = 20;
const OVERDUE_RECHIME_MS  = 30_000;
const SNOOZE_MS           = 60_000;

// ── Audio ──────────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    if (_audioCtx.state === "suspended") void _audioCtx.resume();
    return _audioCtx;
  } catch { return null; }
}

// Three-tone ascending fanfare, repeated 6 times — for new-order arrival.
// Doubled from 3 → 6 reps so the chime is harder to miss in a noisy bar.
function playArrivalChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  for (let rep = 0; rep < 6; rep++) {
    const notes = [660, 880, 1047]; // E5, A5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = freq;
      const start = ctx.currentTime + rep * 1.2 + i * 0.3;
      gain.gain.setValueAtTime(0.4, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + 0.8);
      osc.start(start);
      osc.stop(start + 0.8);
    });
  }
}

// Short two-pip 880Hz alert — for overdue re-chime escalation.
function playEscalationChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.frequency.value = 880;
    const start = ctx.currentTime + i * 0.4;
    gain.gain.setValueAtTime(0.45, start);
    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.3);
    osc.start(start);
    osc.stop(start + 0.3);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function elapsedSec(dateStr: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
}

function formatTimer(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function timeAgo(dateStr: string) {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

type Bucket = "green" | "amber" | "red" | "none";

function prepBucket(createdAt: string, status: string): Bucket {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60_000;
  if (status === "preparing") {
    if (mins <= PREP_GREEN_MAX_MIN) return "green";
    if (mins <= PREP_AMBER_MAX_MIN) return "amber";
    return "red";
  }
  if (status === "ready") {
    return mins <= READY_GREEN_MAX_MIN ? "green" : "red";
  }
  return "none";
}

function firstName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim().split(/\s+/)[0];
  return trimmed || null;
}

// ── Print helper — renders receipt inline + calls window.print() ──

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  "conezion": "Conezion",
  "tamarind": "Tamarind Square",
  "putrajaya": "Celsius Coffee Putrajaya",
};

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildKitchenHtml(order: OrderWithItems): string {
  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  const items = order.order_items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s: { label: string }) => esc(s.label)).join(", ");
    const note = item.modifiers?.specialInstructions;
    return `<div style="margin-bottom:7px">
      <div style="font-size:13px;font-weight:bold">${item.quantity}&times; ${esc(item.product_name)}</div>
      ${mods ? `<div style="font-size:11px;padding-left:10px;color:#333">${mods}</div>` : ""}
      ${note ? `<div style="font-size:11px;padding-left:10px;font-style:italic">* ${esc(note)}</div>` : ""}
    </div>`;
  }).join("");

  return `
    <div style="background:#000;color:#fff;text-align:center;font-size:11px;font-weight:bold;padding:2px 0;letter-spacing:2px;margin-bottom:6px">KITCHEN ORDER</div>
    <div style="text-align:center"><div style="font-size:15px;font-weight:bold;letter-spacing:1px">Celsius Coffee</div><div style="font-size:11px">${esc(store)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:56px;font-weight:900;text-align:center;line-height:1;margin:6px 0;letter-spacing:-2px">#${esc(order.order_number)}</div>
    <div style="text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase">${esc(time)}</div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    ${items}
    ${order.notes ? `<div style="border:2px solid #000;border-radius:2px;padding:4px 6px;margin:4px 0"><div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px">Note</div><div style="font-size:12px;margin-top:2px">${esc(order.notes)}</div></div>` : ""}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:10px;text-align:center;margin-top:6px">SELF-PICKUP</div>
  `;
}

function buildReceiptHtml(order: OrderWithItems): string {
  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(order.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
  const fmt = (sen: number) => `${formatRM((sen / 100))}`;

  const items = order.order_items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s: { label: string }) => esc(s.label)).join(", ");
    return `<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;font-size:11px"><span style="font-weight:bold">${item.quantity}&times; ${esc(item.product_name)}</span><span>${fmt(item.unit_price * item.quantity)}</span></div>
      ${mods ? `<div style="font-size:11px;padding-left:10px;color:#333">${mods}</div>` : ""}
    </div>`;
  }).join("");

  return `
    <div style="text-align:center"><div style="font-size:15px;font-weight:bold;letter-spacing:1px">Celsius Coffee</div><div style="font-size:11px">${esc(store)}</div><div style="font-size:10px;margin-top:2px">${esc(date)} &bull; ${esc(time)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="text-align:center"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase">Order</div><div style="font-size:32px;font-weight:900;line-height:1.1">#${esc(order.order_number)}</div></div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    ${items}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
    ${order.discount_amount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>Voucher</span><span>-${fmt(order.discount_amount)}</span></div>` : ""}
    ${order.sst_amount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span>SST (6%)</span><span>${fmt(order.sst_amount)}</span></div>` : ""}
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:bold;margin-top:4px"><span>TOTAL</span><span>${fmt(order.total)}</span></div>
    <div style="margin-top:4px;font-size:10px">Payment: ${esc((order.payment_method ?? "").toUpperCase().replace(/_/g, " "))}</div>
    <div style="border-top:1px dashed #000;margin:5px 0"></div>
    <div style="font-size:10px;text-align:center;margin-top:6px">Thank you!</div>
  `;
}

function doPrint(_orderId: string, type: "kitchen" | "receipt", order: OrderWithItems) {
  if (isCapacitorNative()) {
    if (type === "kitchen") nativePrintKitchenSlip(order).catch(console.error);
    else nativePrintReceipt(order).catch(console.error);
    return;
  }
  if (hasSunmiPrinter()) {
    if (type === "kitchen") printKitchenSlip(order);
    else printReceipt(order);
    return;
  }
  const html = type === "kitchen" ? buildKitchenHtml(order) : buildReceiptHtml(order);
  let zone = document.getElementById("kds-print-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = "kds-print-zone";
    document.body.appendChild(zone);
  }
  zone.innerHTML = html;

  if (!document.getElementById("kds-print-styles")) {
    const style = document.createElement("style");
    style.id = "kds-print-styles";
    style.textContent = `
      #kds-print-zone { display: none; }
      @media print {
        body > *:not(#kds-print-zone) {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        #kds-print-zone {
          display: block !important;
          position: fixed; top: 0; left: 0; width: 80mm;
          padding: 2mm 4mm; background: #fff; color: #000;
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px; z-index: 999999;
        }
        @page { size: 80mm auto; margin: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  setTimeout(() => window.print(), 100);
}

// ── Order card ─────────────────────────────────────────────────────────────

function StaffOrderCard({
  order,
  tick,
  onAdvance,
  onCancel,
}: {
  order: OrderWithItems;
  tick: number;
  onAdvance: (id: string, status: "ready" | "completed" | "preparing") => Promise<void>;
  onCancel:  (id: string) => Promise<void>;
}) {
  void tick; // forces re-render so the count-up timer ticks each second
  const [busy,   setBusy]   = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const isPreparing = order.status === "preparing";
  const isReady     = order.status === "ready";
  // Prefer prep_started_at (stamped when status hit "preparing") so the
  // timer reflects kitchen time, not order-placed time. Card orders sit
  // in "pending" for 2-3 min while Stripe confirms; created_at would
  // make them look overdue the second they land on the KDS.
  // For "ready" orders, fall back to created_at so the existing stale
  // logic (20-min cutoff) keeps working consistently with prior behavior.
  const timerAnchor = isPreparing
    ? (order.prep_started_at ?? order.created_at)
    : order.created_at;
  const elapsed     = elapsedSec(timerAnchor);
  const bucket      = prepBucket(timerAnchor, order.status);
  const customerFirst = firstName(order.customer_name);
  const itemCount   = order.order_items.reduce((s, i) => s + i.quantity, 0);

  // Strip on left edge — taller than border, easier to scan
  const stripCls =
    bucket === "red"   ? "bg-red-500"   :
    bucket === "amber" ? "bg-amber-400" :
    bucket === "green" ? "bg-emerald-500" :
                         "bg-transparent";

  const borderCls =
    bucket === "red"   ? "border-red-300 shadow-[0_0_0_2px_rgba(239,68,68,0.12)]" :
    bucket === "amber" ? "border-amber-300" :
    bucket === "green" ? "border-emerald-300" :
                         "border-transparent";

  const timerCls =
    bucket === "red"   ? "text-red-600"   :
    bucket === "amber" ? "text-amber-600" :
    isReady            ? "text-emerald-600" :
                         "text-[#160800]";

  // Progress towards target — full bar = at the amber/red boundary (7m for prep, 20m for ready)
  const targetMin = isPreparing ? PREP_AMBER_MAX_MIN : READY_GREEN_MAX_MIN;
  const progressPct = Math.min(100, ((elapsed / 60) / targetMin) * 100);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErrMsg("");
    try { await fn(); } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Something went wrong");
      setTimeout(() => setErrMsg(""), 4000);
    } finally { setBusy(false); }
  }

  return (
    <div className={`relative bg-white rounded-2xl border-2 overflow-hidden transition-colors ${borderCls}`}>
      {/* Urgency strip on left edge */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${stripCls}`} />

      {/* Card header */}
      <div className="flex items-start justify-between px-4 pt-3.5 pb-2 pl-5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-3xl font-black text-[#160800] leading-none shrink-0">#{order.order_number}</span>
          <span className="text-xs font-semibold text-muted-foreground shrink-0">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
          {customerFirst && (
            <span className="text-sm font-semibold text-[#160800]/80 truncate">
              {customerFirst}
            </span>
          )}
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className={`font-mono font-black text-2xl leading-none tabular-nums ${timerCls}`}>
            {formatTimer(elapsed)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            RM {(order.total / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mb-2 ml-5 h-1 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            bucket === "red"   ? "bg-red-500" :
            bucket === "amber" ? "bg-amber-400" :
                                 "bg-emerald-400"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Items */}
      <div className="px-4 pb-3 pl-5 space-y-1.5 border-b border-border/40">
        {order.order_items.map((item) => {
          const mods = (item.modifiers.selections ?? []).map((s: { label: string }) => s.label).join(" · ");
          return (
            <div key={item.id}>
              <p className="text-sm font-bold text-[#160800]">
                {item.quantity}× {item.product_name}
              </p>
              {mods && <p className="text-xs text-muted-foreground ml-3">{mods}</p>}
              {item.modifiers.specialInstructions && (
                <p className="text-xs text-amber-700 ml-3 italic font-medium">
                  ★ {item.modifiers.specialInstructions}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {errMsg && (
        <p className="px-4 pb-1 pl-5 text-xs text-red-500 font-medium">{errMsg}</p>
      )}

      {/* Actions */}
      <div className="px-3 py-3 pl-4 flex gap-2">
        {isPreparing && (
          <>
            <button
              onClick={() => act(() => onAdvance(order.id, "ready"))}
              disabled={busy}
              className="flex-1 bg-green-600 text-white rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              Ready
            </button>
            <button
              onClick={() => doPrint(order.id, "kitchen", order)}
              className="w-12 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
              aria-label="Print kitchen slip"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              onClick={() => act(() => onCancel(order.id))}
              disabled={busy}
              className="w-12 flex items-center justify-center rounded-xl border border-red-200 text-red-500 active:bg-red-50 disabled:opacity-50"
              aria-label="Cancel order"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}

        {isReady && (
          <>
            <button
              onClick={() => act(() => onAdvance(order.id, "preparing"))}
              disabled={busy}
              title="Undo Ready (move back to Preparing)"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={() => act(() => onAdvance(order.id, "completed"))}
              disabled={busy}
              className="flex-1 bg-[#160800] text-white rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
            >
              <Package className="h-4 w-4" />
              Collected
            </button>
            <button
              onClick={() => doPrint(order.id, "kitchen", order)}
              title="Reprint kitchen slip"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              onClick={() => doPrint(order.id, "receipt", order)}
              title="Print receipt"
              className="w-10 flex items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
            >
              <Receipt className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Completed card (read-only) ─────────────────────────────────────────────

function CompletedOrderCard({ order }: { order: OrderWithItems }) {
  const totalRM = (order.total / 100).toFixed(2);
  return (
    <div className="bg-white rounded-2xl border border-border/40 overflow-hidden opacity-90">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="text-xl font-black text-[#160800]">#{order.order_number}</span>
          <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(order.created_at)} ago</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Done</span>
          <p className="text-xs font-bold text-[#160800]">RM {totalRM}</p>
          <button
            onClick={() => doPrint(order.id, "kitchen", order)}
            title="Reprint kitchen slip"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => doPrint(order.id, "receipt", order)}
            title="Reprint receipt"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted"
          >
            <Receipt className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 space-y-0.5 border-t border-border/30 pt-2">
        {order.order_items.map((item) => (
          <p key={item.id} className="text-xs text-muted-foreground">
            {item.quantity}× {item.product_name}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ label, count, accent }: { label: string; count: number; accent: "amber" | "emerald" | "red" }) {
  if (count === 0) return null;
  const dotCls = accent === "red"
    ? "bg-red-500 animate-pulse"
    : accent === "amber"
    ? "bg-amber-400 animate-pulse"
    : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 px-1 pt-1 pb-1">
      <div className={`w-2 h-2 rounded-full ${dotCls}`} />
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label} <span className="text-[#160800]">{count}</span>
      </span>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StaffOrdersPage() {
  const router = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/staff/login"); return; }
    setSession(s);
    setMounted(true);
  }, [router]);

  const storeId = session?.storeId ?? "";
  const [autoPrint, setAutoPrint] = useState(true);
  const [muted,     setMuted]     = useState(false);
  const [tab,       setTab]       = useState<"active" | "completed">("active");
  const [orders,    setOrders]    = useState<OrderWithItems[]>([]);
  const [completed, setCompleted] = useState<OrderWithItems[]>([]);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [tick,      setTick]      = useState(0);
  const [outletBusy, setOutletBusy] = useState(false);
  const [busyToggling, setBusyToggling] = useState(false);

  const autoPrintRef = useRef(autoPrint);
  useEffect(() => { autoPrintRef.current = autoPrint; }, [autoPrint]);

  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  const snoozeUntilRef = useRef(0);
  const lastChimeRef   = useRef(0);

  // Read prefs
  useEffect(() => {
    setAutoPrint(localStorage.getItem("kds-autoprint") !== "off");
    setMuted(localStorage.getItem("kds-muted") === "on");
  }, []);

  // Sync busy state from server on mount + every 60s
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const fetchBusy = async () => {
      try {
        const res = await fetch(`/api/staff/outlet/busy?storeId=${encodeURIComponent(storeId)}`);
        const data = await res.json() as { busy?: boolean };
        if (!cancelled && typeof data.busy === "boolean") setOutletBusy(data.busy);
      } catch { /* keep last known state */ }
    };
    fetchBusy();
    const t = setInterval(fetchBusy, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [storeId]);

  async function toggleBusy() {
    if (!storeId || busyToggling) return;
    setBusyToggling(true);
    const next = !outletBusy;
    setOutletBusy(next);
    try {
      const res = await fetch("/api/staff/outlet/busy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, busy: next }),
      });
      if (!res.ok) setOutletBusy(!next);
    } catch {
      setOutletBusy(!next);
    } finally {
      setBusyToggling(false);
    }
  }

  // Tick — 1Hz when any active order, else 30s for time-ago labels
  useEffect(() => {
    const period = orders.length > 0 ? 1000 : 30_000;
    const t = setInterval(() => setTick((n) => n + 1), period);
    return () => clearInterval(t);
  }, [orders.length]);

  // Audio escalation — fires every OVERDUE_RECHIME_MS while overdue exists & not muted/snoozed
  useEffect(() => {
    const t = setInterval(() => {
      if (mutedRef.current) return;
      if (Date.now() < snoozeUntilRef.current) return;
      const overdue = ordersRef.current.some(
        (o) => o.status === "preparing"
          && prepBucket(o.prep_started_at ?? o.created_at, o.status) === "red",
      );
      if (!overdue) return;
      if (Date.now() - lastChimeRef.current < OVERDUE_RECHIME_MS - 1000) return;
      lastChimeRef.current = Date.now();
      playEscalationChime();
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  function toggleAutoPrint() {
    setAutoPrint((v) => {
      const next = !v;
      localStorage.setItem("kds-autoprint", next ? "on" : "off");
      return next;
    });
  }

  function toggleMute() {
    setMuted((v) => {
      const next = !v;
      localStorage.setItem("kds-muted", next ? "on" : "off");
      return next;
    });
  }

  function snooze() {
    snoozeUntilRef.current = Date.now() + SNOOZE_MS;
    setTick((n) => n + 1);
  }

  // Fetches active orders (preparing + ready) for the given store via the
  // service-role-backed API. Returns null on failure so the caller can
  // surface a disconnected state in the header.
  const fetchActiveOrders = useCallback(async (sid: string): Promise<OrderWithItems[] | null> => {
    try {
      const res = await fetch(
        `/api/staff/orders/feed?store=${encodeURIComponent(sid)}&statuses=preparing,ready`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      const data = await res.json() as OrderWithItems[];
      return Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }, []);

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef     = useRef(true);

  // Poll the active-orders feed every POLL_INTERVAL_MS. Detects new
  // arrivals by diffing IDs against knownOrderIdsRef — on each new
  // arrival, plays the chime + auto-prints (subject to mute / autoprint
  // prefs). First load seeds knownOrderIds without chiming so a fresh
  // page load doesn't fire chimes for orders already in the queue.
  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;

    const poll = async () => {
      const fresh = await fetchActiveOrders(storeId);
      if (cancelled) return;

      if (fresh === null) {
        // Network / server error — surface disconnected state, keep last list.
        setConnected(false);
        return;
      }

      setConnected(true);
      const freshIds = new Set(fresh.map((o) => o.id));

      if (firstLoadRef.current) {
        // Seed without chiming or printing.
        knownOrderIdsRef.current = freshIds;
        firstLoadRef.current = false;
      } else {
        for (const order of fresh) {
          if (!knownOrderIdsRef.current.has(order.id)) {
            if (!mutedRef.current) playArrivalChime();
            if (autoPrintRef.current) setTimeout(() => doPrint(order.id, "kitchen", order), 400);
          }
        }
        knownOrderIdsRef.current = freshIds;
      }

      setOrders(fresh);
    };

    void poll();
    const t = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [storeId, fetchActiveOrders]);

  async function handleAdvance(orderId: string, newStatus: "ready" | "completed" | "preparing") {
    const res  = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
    if (newStatus === "completed") {
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    } else {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
    }
  }

  async function handleCancel(orderId: string) {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    });
    if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "Failed"); }
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  // Today's completed orders — fetched on tab open + refreshed every 15s
  // while the tab is active. (Lower-stakes than the active queue, so we
  // poll less aggressively to save cycles.)
  useEffect(() => {
    if (tab !== "completed" || !storeId) return;
    let cancelled = false;
    setLoadingCompleted(true);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const fromIso = todayStart.toISOString();

    const fetchCompleted = async () => {
      try {
        const res = await fetch(
          `/api/staff/orders/feed?store=${encodeURIComponent(storeId)}&statuses=completed&from=${encodeURIComponent(fromIso)}&dir=desc`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = await res.json() as OrderWithItems[];
        if (!cancelled && Array.isArray(data)) setCompleted(data);
      } catch { /* keep last list */ }
      finally {
        if (!cancelled) setLoadingCompleted(false);
      }
    };

    void fetchCompleted();
    const t = setInterval(fetchCompleted, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tab, storeId]);

  // Derived: split + sort + count overdue (recomputed each tick)
  const { preparing, ready, overdueCount } = useMemo(() => {
    void tick;
    const prep = orders
      .filter((o) => o.status === "preparing")
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const rdy = orders
      .filter((o) => o.status === "ready")
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const over = prep.filter(
      (o) => prepBucket(o.prep_started_at ?? o.created_at, "preparing") === "red",
    ).length;
    return { preparing: prep, ready: rdy, overdueCount: over };
  }, [orders, tick]);

  const total = orders.length;
  const snoozed = Date.now() < snoozeUntilRef.current;

  if (!mounted || !session) return <div className="min-h-dvh bg-[#160800]" />;

  return (
    <div className="min-h-dvh bg-[#f0f0f0] flex flex-col select-none pb-16">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 py-3 flex items-center justify-between shrink-0 gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/celsius-wordmark-white.png"
            alt="Celsius Coffee"
            className="h-5 w-auto"
          />
          <p className="text-white/50 text-xs truncate">{session.storeName}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Overdue chip — tap to snooze */}
          {overdueCount > 0 && tab === "active" && (
            <button
              onClick={snooze}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full bg-red-500/90 text-white font-bold animate-pulse active:opacity-80"
            >
              {overdueCount} OVERDUE
              {snoozed && <span className="opacity-70 font-normal">· snoozed</span>}
            </button>
          )}
          {/* Mute */}
          <button
            onClick={toggleMute}
            className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors ${
              muted ? "bg-white/8 text-white/40 border-white/10" : "bg-white/8 text-white/70 border-white/10"
            }`}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </button>
          {/* Busy */}
          <button
            onClick={toggleBusy}
            disabled={busyToggling}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
              outletBusy
                ? "bg-red-500/25 text-red-200 border-red-400/40"
                : "bg-white/8 text-white/40 border-white/10"
            }`}
          >
            {outletBusy ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {outletBusy ? "Busy" : "Open"}
          </button>
          {/* Auto-print */}
          {tab === "active" && (
            <button
              onClick={toggleAutoPrint}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                autoPrint
                  ? "bg-green-500/20 text-green-300 border-green-500/30"
                  : "bg-white/8 text-white/30 border-white/10"
              }`}
            >
              <Printer className="h-3 w-3" />
              {autoPrint ? "Auto" : "Manual"}
            </button>
          )}
          {connected
            ? <Wifi className="h-4 w-4 text-green-400" />
            : <Wifi className="h-4 w-4 text-amber-400" />
          }
        </div>
      </header>

      {outletBusy && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs font-semibold px-4 py-2 text-center shrink-0">
          Outlet marked busy — customers can&apos;t place new pickup orders.
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b shrink-0">
        <div className="flex">
          <button
            onClick={() => setTab("active")}
            className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === "active" ? "border-[#160800] text-[#160800]" : "border-transparent text-muted-foreground"
            }`}
          >
            Active
            {total > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-white text-[9px] font-bold ${
                overdueCount > 0 ? "bg-red-500" : "bg-amber-400"
              }`}>
                {total}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === "completed" ? "border-[#160800] text-[#160800]" : "border-transparent text-muted-foreground"
            }`}
          >
            Completed
            {completed.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-gray-400 text-white text-[9px] font-bold">
                {completed.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-4">
        {tab === "active" ? (
          orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Package className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No active orders</p>
              <p className="text-xs text-muted-foreground/60 mt-1">New orders will appear here</p>
            </div>
          ) : (
            <>
              <SectionHeader
                label="Preparing"
                count={preparing.length}
                accent={overdueCount > 0 ? "red" : "amber"}
              />
              {preparing.map((order) => (
                <StaffOrderCard
                  key={order.id}
                  order={order}
                  tick={tick}
                  onAdvance={handleAdvance}
                  onCancel={handleCancel}
                />
              ))}
              {ready.length > 0 && <div className="h-2" />}
              <SectionHeader label="Ready for collection" count={ready.length} accent="emerald" />
              {ready.map((order) => (
                <StaffOrderCard
                  key={order.id}
                  order={order}
                  tick={tick}
                  onAdvance={handleAdvance}
                  onCancel={handleCancel}
                />
              ))}
            </>
          )
        ) : loadingCompleted ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
          </div>
        ) : completed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <CheckCircle className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">No completed orders today</p>
          </div>
        ) : (
          completed.map((order) => (
            <CompletedOrderCard key={order.id} order={order} />
          ))
        )}
      </div>

      <StaffNav active="orders" />
    </div>
  );
}
