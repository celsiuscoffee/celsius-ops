"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert, Check, Eye, RefreshCw, Send } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Alert = {
  id: string;
  signal: string;
  severity: string;
  summary: string;
  status: string;
  outletName: string | null;
  assigneeName: string | null;
  sentAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SEV_CLASS: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MED: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

export default function PulsePanel({ onChange }: { onChange: () => void }) {
  const { data, isLoading, mutate } = useFetch<{ alerts: Alert[] }>("/api/ops/workspace/pulse");
  const alerts = data?.alerts ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/ops/workspace/test-pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      setTestMsg(
        res.ok
          ? { ok: true, text: `Test pulse sent to ${j.to ?? "your number"} — check WhatsApp.` }
          : { ok: false, text: j.message || j.error || "Failed to send test pulse." },
      );
    } catch {
      setTestMsg({ ok: false, text: "Network error sending test pulse." });
    } finally {
      setTesting(false);
    }
  };

  const act = async (id: string, action: "resolve" | "ack") => {
    setBusy(id);
    try {
      await fetch(`/api/ops/workspace/pulse/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await mutate();
      onChange();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="h-[calc(100vh-15rem)] overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-terracotta" />
        <span className="text-sm font-medium">Open pulse alerts</span>
        <Input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="Send to (blank = me)"
          className="ml-auto h-7 w-44 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={sendTest}
          disabled={testing}
          className="h-7 gap-1 px-2 text-xs"
          title="Send a sample pulse digest — blank = you, or enter a number (owner/admin)"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send test pulse
        </Button>
        <button onClick={() => mutate()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      {testMsg && (
        <div
          className={
            "mb-3 rounded-md px-3 py-2 text-xs " +
            (testMsg.ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800")
          }
        >
          {testMsg.text}
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          🎉 No open alerts. The pulse is quiet.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => {
            const escalated = a.status === "ESCALATED";
            return (
              <li
                key={a.id}
                className={
                  "rounded-lg border p-3 " + (escalated ? "border-red-200 bg-red-50/40" : "bg-card")
                }
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className={"text-[10px] " + (SEV_CLASS[a.severity] ?? "bg-slate-100 text-slate-600")}>
                    {a.severity}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {a.signal}
                  </Badge>
                  {escalated && (
                    <Badge className="bg-red-600 text-[10px] text-white">ESCALATED</Badge>
                  )}
                  {a.outletName && (
                    <span className="text-[11px] text-muted-foreground">· {a.outletName}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {fmtTime(a.escalatedAt || a.sentAt || a.createdAt)}
                  </span>
                </div>

                <div className="mt-1.5 text-sm text-foreground">{a.summary}</div>

                <div className="mt-2 flex items-center gap-2">
                  {a.assigneeName && (
                    <span className="text-[11px] text-muted-foreground">→ {a.assigneeName}</span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === a.id}
                      onClick={() => act(a.id, "ack")}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" /> Ack
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => act(a.id, "resolve")}
                      className="h-7 gap-1 bg-terracotta px-2 text-xs hover:bg-terracotta-dark"
                    >
                      {busy === a.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Resolve
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
