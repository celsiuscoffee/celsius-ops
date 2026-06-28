"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Megaphone,
  Send,
  Users,
  Store,
  Briefcase,
  UserCog,
  Check,
  BellRing,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type StaffOpt = { id: string; name: string; role: string };
type OutletOpt = { id: string; name: string };
type DisciplineOpt = { key: string; label: string };

type Instruction = {
  id: string;
  title: string;
  body: string;
  severity: string;
  audienceLabel: string;
  createdByName: string | null;
  createdAt: string;
  total: number;
  acked: number;
  delivered: number;
  pending: number;
};

type Recipient = {
  id: string;
  name: string;
  phone: string | null;
  deliveryStatus: string;
  sentAt: string | null;
  ackedAt: string | null;
  error: string | null;
};

type Detail = Instruction & { recipients: Recipient[] };

type Payload = {
  instructions: Instruction[];
  options: { staff: StaffOpt[]; outlets: OutletOpt[]; disciplines: DisciplineOpt[] };
};

type AudienceType = "all_managers" | "discipline" | "outlet" | "users";

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SEV_CLASS: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  important: "bg-amber-100 text-amber-700",
  normal: "bg-slate-100 text-slate-600",
};

export default function InstructionsPanel({ onChange }: { onChange: () => void }) {
  const { data, isLoading, mutate } = useFetch<Payload>("/api/ops/workspace/instructions");
  const instructions = data?.instructions ?? [];
  const staff = data?.options.staff ?? [];
  const outlets = data?.options.outlets ?? [];
  const disciplines = data?.options.disciplines ?? [];

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("normal");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_managers");
  const [routeKey, setRouteKey] = useState("operations");
  const [outletId, setOutletId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [staffQuery, setStaffQuery] = useState("");

  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const filteredStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    return q ? staff.filter((s) => s.name.toLowerCase().includes(q)) : staff;
  }, [staff, staffQuery]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const audiencePayload = () => {
    switch (audienceType) {
      case "discipline":
        return { type: "discipline", routeKey };
      case "outlet":
        return { type: "outlet", outletId };
      case "users":
        return { type: "users", userIds: Array.from(picked) };
      default:
        return { type: "all_managers" };
    }
  };

  const canSend =
    title.trim().length > 0 &&
    !sending &&
    (audienceType !== "users" || picked.size > 0) &&
    (audienceType !== "outlet" || !!outletId);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ops/workspace/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), severity, audience: audiencePayload() }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const bits = [`sent to ${j.sent}/${j.total}`];
        if (j.skipped) bits.push(`${j.skipped} no phone`);
        if (j.failed) bits.push(`${j.failed} failed`);
        setMsg({ ok: true, text: `Instruction sent — ${bits.join(", ")}.` });
        setTitle("");
        setBody("");
        setPicked(new Set());
        await mutate();
        onChange();
      } else {
        setMsg({ ok: false, text: j.message || j.error || "Failed to send instruction." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error sending instruction." });
    } finally {
      setSending(false);
    }
  };

  const audienceTabs: { key: AudienceType; label: string; Icon: typeof Users }[] = [
    { key: "all_managers", label: "All managers", Icon: UserCog },
    { key: "discipline", label: "Discipline", Icon: Briefcase },
    { key: "outlet", label: "Outlet (on shift)", Icon: Store },
    { key: "users", label: "Pick staff", Icon: Users },
  ];

  return (
    <Card className="h-[calc(100vh-15rem)] overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-terracotta" />
        <span className="text-sm font-medium">Send an instruction</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Directive over WhatsApp — tracked per person until they confirm
        </span>
      </div>

      {/* Composer */}
      <div className="mb-5 rounded-lg border bg-muted/30 p-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Instruction — e.g. 'Switch to the new opening checklist from tomorrow'"
          className="mb-2"
          disabled={sending}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details (optional)"
          rows={2}
          className="mb-2 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
          disabled={sending}
        />

        {/* Audience selector */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {audienceTabs.map(({ key, label, Icon }) => {
            const active = audienceType === key;
            return (
              <button
                key={key}
                onClick={() => setAudienceType(key)}
                className={
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition " +
                  (active ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:text-foreground")
                }
                disabled={sending}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        {audienceType === "discipline" && (
          <select
            value={routeKey}
            onChange={(e) => setRouteKey(e.target.value)}
            className="mb-2 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
            disabled={sending}
          >
            {disciplines.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        )}

        {audienceType === "outlet" && (
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="mb-2 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
            disabled={sending}
          >
            <option value="">Select an outlet…</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}

        {audienceType === "users" && (
          <div className="mb-2">
            <Input
              value={staffQuery}
              onChange={(e) => setStaffQuery(e.target.value)}
              placeholder="Search staff…"
              className="mb-1.5 h-8 text-xs"
              disabled={sending}
            />
            <div className="max-h-40 overflow-y-auto rounded-md border bg-background p-1">
              {filteredStaff.map((s) => {
                const on = picked.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => togglePick(s.id)}
                    className={
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition " +
                      (on ? "bg-terracotta/10 text-terracotta" : "hover:bg-muted")
                    }
                    disabled={sending}
                  >
                    <span
                      className={
                        "flex h-4 w-4 items-center justify-center rounded border " +
                        (on ? "border-terracotta bg-terracotta text-white" : "border-muted-foreground/40")
                      }
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground">{s.role}</span>
                  </button>
                );
              })}
              {filteredStaff.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">No staff match.</div>
              )}
            </div>
            {picked.size > 0 && <div className="mt-1 text-[11px] text-muted-foreground">{picked.size} selected</div>}
          </div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            disabled={sending}
          >
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
          <Button onClick={send} disabled={!canSend} className="ml-auto gap-1 bg-terracotta hover:bg-terracotta-dark">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
          </Button>
        </div>

        {msg && (
          <div
            className={
              "mt-2 rounded-md px-3 py-2 text-xs " + (msg.ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800")
            }
          >
            {msg.text}
          </div>
        )}
      </div>

      {/* Sent instructions */}
      <div className="mb-2 text-xs font-medium text-muted-foreground">Sent instructions</div>
      {isLoading ? (
        <div className="p-6 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : instructions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No instructions sent yet. Compose one above.
        </div>
      ) : (
        <ul className="space-y-2">
          {instructions.map((ins) => (
            <InstructionRow key={ins.id} ins={ins} onAck={() => { mutate(); onChange(); }} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function InstructionRow({ ins, onAck }: { ins: Instruction; onAck: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: detail, mutate: mutateDetail } = useFetch<Detail>(
    open ? `/api/ops/workspace/instructions/${ins.id}` : null,
  );

  const act = async (action: "nudge" | "ack", recipientId?: string) => {
    setBusy(true);
    try {
      await fetch(`/api/ops/workspace/instructions/${ins.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, recipientId }),
      });
      await mutateDetail();
      onAck();
    } finally {
      setBusy(false);
    }
  };

  const allAcked = ins.total > 0 && ins.acked === ins.total;

  return (
    <li className="rounded-lg border bg-card p-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {ins.severity !== "normal" && (
              <Badge className={"text-[10px] " + (SEV_CLASS[ins.severity] ?? SEV_CLASS.normal)}>{ins.severity}</Badge>
            )}
            <span className="text-sm font-medium text-foreground">{ins.title}</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtTime(ins.createdAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>→ {ins.audienceLabel || "recipients"}</span>
            <Badge
              className={"text-[10px] " + (allAcked ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700")}
            >
              {ins.acked}/{ins.total} confirmed
            </Badge>
            {ins.createdByName && <span>· by {ins.createdByName}</span>}
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t pt-3">
          {ins.body && <div className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{ins.body}</div>}
          <div className="mb-2 flex items-center gap-2">
            {ins.pending > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("nudge")}
                className="h-7 gap-1 px-2 text-xs"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                Nudge {ins.pending} pending
              </Button>
            )}
          </div>
          {!detail ? (
            <div className="py-2 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : (
            <ul className="space-y-1">
              {detail.recipients.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={
                      "flex h-4 w-4 items-center justify-center rounded-full " +
                      (r.ackedAt ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")
                    }
                  >
                    {r.ackedAt && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1 truncate text-foreground">{r.name}</span>
                  {r.ackedAt ? (
                    <span className="text-[10px] text-green-700">confirmed {fmtTime(r.ackedAt)}</span>
                  ) : r.deliveryStatus === "skipped" ? (
                    <span className="text-[10px] text-amber-700">no phone</span>
                  ) : r.deliveryStatus === "failed" ? (
                    <span className="text-[10px] text-red-600">not delivered</span>
                  ) : (
                    <button
                      onClick={() => act("ack", r.id)}
                      disabled={busy}
                      className="text-[10px] text-muted-foreground underline hover:text-foreground"
                      title="Mark confirmed manually"
                    >
                      mark confirmed
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
