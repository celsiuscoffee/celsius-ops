"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  Send,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Clock,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Thread = {
  staffPhone: string;
  userId: string | null;
  name: string | null;
  role: string | null;
  lastBody: string;
  lastDirection: "IN" | "OUT";
  lastAt: string;
  windowOpen: boolean;
  awaitingReply: boolean;
  openAlerts: number;
  messageCount: number;
};

type Message = {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  type: string;
  templateName: string | null;
  status: string | null;
  error: string | null;
  sentAt: string;
};

type OpenAlert = {
  id: string;
  signal: string;
  severity: string;
  summary: string;
  status: string;
  sentAt: string | null;
};

type ThreadDetail = {
  staffPhone: string;
  userId: string | null;
  name: string | null;
  role: string | null;
  windowOpen: boolean;
  openAlerts: OpenAlert[];
  messages: Message[];
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtPhone(p: string): string {
  return /^60\d+$/.test(p) ? "+" + p : p;
}

export default function ChatInboxPage() {
  const { data, isLoading, mutate: mutateList } = useFetch<{ threads: Thread[] }>("/api/ops/chat-inbox");
  const threads = data?.threads ?? [];

  const [selected, setSelected] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading, mutate: mutateThread } = useFetch<ThreadDetail>(
    selected ? `/api/ops/chat-inbox/${encodeURIComponent(selected)}` : null,
  );

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  // Auto-select the most recent conversation once the list loads.
  useEffect(() => {
    if (!selected && threads.length) setSelected(threads[0].staffPhone);
  }, [threads, selected]);

  // Keep it live: re-poll the list and the open thread every 20s.
  useEffect(() => {
    const id = setInterval(() => {
      mutateList();
      if (selected) mutateThread();
    }, 20000);
    return () => clearInterval(id);
  }, [selected, mutateList, mutateThread]);

  const send = async () => {
    const value = text.trim();
    if (!selected || !value) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch(`/api/ops/chat-inbox/${encodeURIComponent(selected)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSendError(j.message || j.error || "Failed to send");
      } else {
        setText("");
        await mutateThread();
        await mutateList();
      }
    } catch {
      setSendError("Network error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-terracotta" />
        <h1 className="text-lg font-semibold">Chat Inbox</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          WhatsApp — ops-pulse digests &amp; staff replies
        </span>
        <button
          onClick={() => {
            mutateList();
            if (selected) mutateThread();
          }}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        {/* Thread list */}
        <Card className="h-[calc(100vh-12rem)] overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet. Messages appear here as staff reply to ops-pulse digests, or
              message the WhatsApp number.
            </div>
          ) : (
            <ul className="divide-y">
              {threads.map((t) => {
                const active = t.staffPhone === selected;
                return (
                  <li key={t.staffPhone}>
                    <button
                      onClick={() => setSelected(t.staffPhone)}
                      className={
                        "w-full px-3 py-2.5 text-left transition " +
                        (active ? "bg-brand-offwhite" : "hover:bg-gray-50")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {t.name || fmtPhone(t.staffPhone)}
                        </span>
                        {t.role && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t.role}
                          </Badge>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {fmtTime(t.lastAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {t.lastDirection === "OUT" ? "You: " : ""}
                        {t.lastBody}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {t.awaitingReply && (
                          <Badge className="bg-blue-100 text-[10px] text-blue-700">New reply</Badge>
                        )}
                        {t.openAlerts > 0 && (
                          <Badge className="bg-amber-100 text-[10px] text-amber-700">
                            {t.openAlerts} open alert{t.openAlerts === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {!t.windowOpen && (
                          <Badge variant="secondary" className="text-[10px]">
                            window closed
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Thread detail */}
        <Card className="flex h-[calc(100vh-12rem)] flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          ) : detailLoading && !detail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No messages
            </div>
          ) : (
            <>
              {/* header */}
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {detail.name || fmtPhone(detail.staffPhone)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtPhone(detail.staffPhone)}
                    {detail.role ? ` · ${detail.role}` : ""}
                  </div>
                </div>
                {detail.openAlerts.length > 0 && (
                  <Badge className="ml-auto flex items-center gap-1 bg-amber-100 text-[10px] text-amber-700">
                    <ShieldAlert className="h-3 w-3" />
                    {detail.openAlerts.length} open alert{detail.openAlerts.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>

              {/* messages */}
              <div className="flex-1 space-y-2 overflow-y-auto bg-brand-offwhite/40 p-4">
                {detail.messages.map((m) => {
                  const out = m.direction === "OUT";
                  return (
                    <div key={m.id} className={"flex " + (out ? "justify-end" : "justify-start")}>
                      <div
                        className={
                          "max-w-[78%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
                          (out ? "bg-terracotta text-white" : "border bg-white text-foreground")
                        }
                      >
                        {m.body}
                        <div
                          className={
                            "mt-1 flex items-center gap-1 text-[10px] " +
                            (out ? "text-white/70" : "text-muted-foreground")
                          }
                        >
                          <span>{fmtTime(m.sentAt)}</span>
                          {out && m.status && <span>· {m.status}</span>}
                          {out && m.templateName && <span>· template</span>}
                          {m.status === "failed" && <AlertTriangle className="h-3 w-3" />}
                        </div>
                        {m.error && (
                          <div className={out ? "mt-0.5 text-[10px] text-white/80" : "mt-0.5 text-[10px] text-red-600"}>
                            {m.error}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* reply box */}
              <div className="border-t p-3">
                {detail.windowOpen ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="Type a reply…"
                      disabled={sending}
                    />
                    <Button
                      onClick={send}
                      disabled={sending || !text.trim()}
                      className="bg-terracotta hover:bg-terracotta-dark"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Outside the 24-hour reply window — WhatsApp only allows free-form replies within
                      24h of the recipient&apos;s last message. They&apos;ll need to message the bot
                      again (or you send an approved template) before you can reply here.
                    </span>
                  </div>
                )}
                {sendError && <div className="mt-1 text-xs text-red-600">{sendError}</div>}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
