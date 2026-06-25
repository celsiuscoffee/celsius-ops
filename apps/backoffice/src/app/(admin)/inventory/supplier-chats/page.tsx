"use client";

import { useState, useEffect } from "react";
import { useFetch } from "@/lib/use-fetch";
import { formatRM } from "@celsius/shared";
import {
  MessageCircle,
  AlertCircle,
  Clock,
  FileText,
  Send,
  Loader2,
  Phone,
} from "lucide-react";

type Thread = {
  key: string;
  supplierId: string | null;
  name: string;
  phone: string;
  preview: string;
  lastAt: string;
  count: number;
  needsAttention: boolean;
};

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  status: string | null;
  timestamp: string;
};

type Detail = {
  key: string;
  supplierId: string | null;
  supplier: null | {
    id: string;
    name: string;
    phone: string | null;
    deliveryDays: string[];
    paymentTerms: string | null;
    leadTimeDays: number;
  };
  context: {
    openPOs: number;
    unpaidTotal: number;
    overdueTotal: number;
    recentPOs: { orderNumber: string; status: string }[];
  };
  windowOpen: boolean;
  messages: Msg[];
};

function rel(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export default function SupplierChatsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");

  const { data: threadsData, isLoading } = useFetch<{ threads: Thread[]; needsAttention: number }>(
    "/api/inventory/supplier-chats",
  );
  const { data: detail, mutate: mutateDetail } = useFetch<Detail>(
    selected ? `/api/inventory/supplier-chats/${selected}` : null,
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threads = threadsData?.threads ?? [];
  const shown = filter === "attention" ? threads.filter((t) => t.needsAttention) : threads;

  useEffect(() => {
    if (!selected && threads.length) setSelected(threads[0].key);
  }, [threads, selected]);

  useEffect(() => {
    setDraft("");
    setSendError(null);
  }, [selected]);

  async function send() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/inventory/supplier-chats/${selected}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(json.error ?? "Send failed");
        return;
      }
      setDraft("");
      mutateDetail();
    } catch {
      setSendError("Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[560px] overflow-hidden rounded-lg border border-border bg-background text-foreground">
      {/* ── Thread list ─────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageCircle size={16} /> Supplier chats
          </div>
          <div className="mt-2 flex gap-1">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-full px-2.5 py-0.5 text-xs ${filter === "all" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("attention")}
              className={`rounded-full px-2.5 py-0.5 text-xs ${filter === "attention" ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted"}`}
            >
              Needs attention {threadsData?.needsAttention ?? 0}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!isLoading && shown.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">
              No supplier messages yet. They appear here once the WhatsApp number is live and receiving.
            </p>
          )}
          {shown.map((t) => (
            <button
              key={t.key}
              onClick={() => setSelected(t.key)}
              className={`flex w-full gap-2.5 border-b border-border p-2.5 text-left ${selected === t.key ? "bg-muted" : "hover:bg-muted/50"}`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                {initials(t.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between">
                  <span className="truncate text-[13px] font-medium">{t.name}</span>
                  <span className="shrink-0 pl-1 text-[11px] text-muted-foreground">{rel(t.lastAt)}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {t.needsAttention && <AlertCircle size={11} className="shrink-0 text-destructive" />}
                  <span className="truncate">{t.preview}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Conversation ────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-border">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a chat
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <div className="text-sm font-medium">{detail.supplier?.name ?? `+${detail.key}`}</div>
                <div className="text-xs text-muted-foreground">+{detail.key}</div>
              </div>
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600 dark:text-green-400">
                WhatsApp
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
              {detail.messages.length === 0 && (
                <p className="m-auto text-xs text-muted-foreground">No messages in this thread yet.</p>
              )}
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-snug ${
                    m.direction === "outbound"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-muted text-foreground"
                  }`}
                >
                  {m.body ?? (
                    <span className="inline-flex items-center gap-1">
                      <FileText size={13} /> {m.type}
                    </span>
                  )}
                  <div
                    className={`mt-1 text-[10px] ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {clock(m.timestamp)}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                  disabled={!detail.windowOpen || sending}
                  placeholder={
                    detail.windowOpen ? "Type a reply…" : "Window closed — free text not allowed (template only)"
                  }
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={!detail.windowOpen || sending || !draft.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-40"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <Clock
                  size={12}
                  className={detail.windowOpen ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}
                />
                <span className="text-muted-foreground">
                  {detail.windowOpen ? "24h window open — free reply" : "24h window closed — template only"}
                </span>
                {sendError && <span className="ml-auto text-destructive">{sendError}</span>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Supplier context ────────────────────────── */}
      <div className="w-60 shrink-0 overflow-y-auto p-3">
        {!detail ? null : (
          <>
            <div className="flex flex-col items-center gap-1.5 border-b border-border pb-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {initials(detail.supplier?.name ?? detail.key)}
              </div>
              <div className="text-[13px] font-medium">{detail.supplier?.name ?? `+${detail.key}`}</div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Phone size={11} /> +{detail.key}
              </div>
            </div>

            {detail.supplierId ? (
              <>
                <div className="flex flex-col gap-1.5 border-b border-border py-3">
                  <div className="rounded-md bg-muted px-2.5 py-1.5">
                    <div className="text-[11px] text-muted-foreground">Open POs</div>
                    <div className="text-[15px] font-medium">{detail.context.openPOs}</div>
                  </div>
                  <div className="rounded-md bg-muted px-2.5 py-1.5">
                    <div className="text-[11px] text-muted-foreground">Unpaid</div>
                    <div className="text-[15px] font-medium">{formatRM(detail.context.unpaidTotal)}</div>
                  </div>
                  {detail.context.overdueTotal > 0 && (
                    <div className="rounded-md bg-destructive/10 px-2.5 py-1.5">
                      <div className="text-[11px] text-destructive">Overdue</div>
                      <div className="text-[15px] font-medium text-destructive">
                        {formatRM(detail.context.overdueTotal)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 border-b border-border py-3 text-[12px]">
                  <Row label="Delivery" value={detail.supplier?.deliveryDays?.join(", ") || "—"} />
                  <Row label="Lead time" value={`${detail.supplier?.leadTimeDays ?? 0}d`} />
                  <Row label="Terms" value={detail.supplier?.paymentTerms || "—"} />
                </div>
                <div className="pt-3">
                  <div className="mb-1.5 text-[11px] text-muted-foreground">Open purchase orders</div>
                  {detail.context.recentPOs.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">None open.</p>
                  )}
                  {detail.context.recentPOs.map((po) => (
                    <div key={po.orderNumber} className="flex justify-between py-0.5 text-[11px]">
                      <span>{po.orderNumber}</span>
                      <span className="text-muted-foreground">{po.status.replace(/_/g, " ").toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="py-4 text-[11px] text-muted-foreground">
                Not linked to a supplier yet — no procurement context. Match this number on the supplier record to see open POs and balances.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
