"use client";

import { useMemo, useState } from "react";
import { KanbanSquare, Plus, Loader2, Trash2, Check, ExternalLink, Clock, MessageCircle, Sparkles, ChevronRight } from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/use-fetch";

// The owner's personal kanban over OpsReminder. Five columns; drag a card
// between them, or use the buttons on the card. Triage holds cards the
// capture agent proposed from the owner's own chats: dragging one out is an
// accept, the bin is a reject. Design: docs/design/owner-todo-kanban.md.

type Stage = "triage" | "todo" | "doing" | "waiting" | "done";
const STAGES: Stage[] = ["triage", "todo", "doing", "waiting", "done"];
const LABEL: Record<Stage, string> = { triage: "Triage", todo: "To Do", doing: "Doing", waiting: "Waiting on", done: "Done" };

type Card = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  overdue: boolean;
  stage: Stage;
  status: string;
  source: string;
  sourceChat: string | null;
  sourceExcerpt: string | null;
  sourceRef: string | null;
  proposedByAgent: boolean;
  confidence: number | null;
  createdAt: string;
  doneAt: string | null;
};
type Stats = { proposed: number; accepted: number; rejected: number; pending: number; precision: number | null };
type Payload = { cards: Card[]; stats: Stats };

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short" });
}

// whatsapp:// deep link to the originating chat. Group jids cannot be opened
// directly, so those fall back to opening WhatsApp itself.
function chatHref(c: Card): string | null {
  if (c.source !== "whatsapp" || !c.sourceRef) return null;
  const jid = c.sourceRef.split("#")[0];
  if (jid.endsWith("@s.whatsapp.net")) return `https://wa.me/${jid.replace("@s.whatsapp.net", "")}`;
  return "whatsapp://";
}

export default function OwnerTodoPage() {
  const { data, isLoading, mutate } = useFetch<Payload>("/api/owner/todo");
  const cards = useMemo(() => data?.cards ?? [], [data]);
  const stats = data?.stats;
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<Card | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const byStage = useMemo(() => {
    const m: Record<Stage, Card[]> = { triage: [], todo: [], doing: [], waiting: [], done: [] };
    for (const c of cards) m[c.stage]?.push(c);
    return m;
  }, [cards]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      await fetch(`/api/owner/todo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await fetch("/api/owner/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, dueAt: due ? new Date(`${due}T09:00:00+08:00`).toISOString() : null }),
      });
      setTitle("");
      setDue("");
      await mutate();
    } finally {
      setSaving(false);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    setActive(cards.find((c) => c.id === String(e.active.id)) ?? null);
  };
  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const to = e.over?.id as Stage | undefined;
    const card = cards.find((c) => c.id === String(e.active.id));
    if (!to || !card || to === card.stage || to === "triage") return;
    await patch(card.id, { stage: to });
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <KanbanSquare className="h-5 w-5 text-terracotta" />
        <h1 className="text-lg font-semibold">My board</h1>
        <span className="text-xs text-muted-foreground">
          {cards.filter((c) => c.stage !== "done").length} open
        </span>
        {stats && stats.proposed > 0 && (
          <Badge variant="outline" className="ml-auto gap-1 text-xs font-normal">
            <Sparkles className="h-3 w-3" />
            capture {stats.precision == null ? "no verdicts yet" : `${Math.round(stats.precision * 100)}% accepted`} · {stats.pending} pending
          </Badge>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
          placeholder="Add a card, e.g. 'Reply Sentai on the wall light proposal'"
          className="flex-1"
          disabled={saving}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
          disabled={saving}
        />
        <Button onClick={create} disabled={saving || !title.trim()} className="gap-1">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your board
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {STAGES.map((s) => (
              <Column key={s} stage={s} cards={byStage[s]} droppable={s !== "triage"}>
                {byStage[s].map((c) => (
                  <CardItem
                    key={c.id}
                    card={c}
                    busy={busy === c.id}
                    open={openId === c.id}
                    onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                    onMove={(to) => patch(c.id, { stage: to })}
                    onReject={() => patch(c.id, { action: "reject" })}
                    onTomorrow={() => patch(c.id, { action: "tomorrow" })}
                  />
                ))}
                {byStage[s].length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    {s === "triage" ? "Nothing proposed" : "Empty"}
                  </div>
                )}
              </Column>
            ))}
          </div>
          <DragOverlay>{active ? <div className="rounded-md border bg-card p-2 text-sm shadow-lg">{active.title}</div> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Column({ stage, cards, droppable, children }: { stage: Stage; cards: Card[]; droppable: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !droppable });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[40vh] flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition-colors ${isOver && droppable ? "border-terracotta bg-terracotta/5" : ""}`}
    >
      <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1">
          {stage === "triage" && <Sparkles className="h-3 w-3" />}
          {LABEL[stage]}
        </span>
        <span>{cards.length}</span>
      </div>
      {children}
    </div>
  );
}

function CardItem({
  card,
  busy,
  open,
  onToggle,
  onMove,
  onReject,
  onTomorrow,
}: {
  card: Card;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onMove: (to: Stage) => void;
  onReject: () => void;
  onTomorrow: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  const href = chatHref(card);
  const next: Stage | null = card.stage === "triage" ? "todo" : card.stage === "todo" ? "doing" : card.stage === "doing" ? "done" : card.stage === "waiting" ? "done" : null;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-md border bg-card p-2 text-sm shadow-sm ${isDragging ? "opacity-40" : ""} ${card.stage === "done" ? "opacity-70" : ""}`}
    >
      <button type="button" className="w-full text-left" onClick={onToggle}>
        <div className={`font-medium leading-snug ${card.stage === "done" ? "line-through" : ""}`}>{card.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {card.dueAt && (
            <span className={`flex items-center gap-0.5 ${card.overdue ? "font-medium text-red-600" : ""}`}>
              <Clock className="h-3 w-3" /> {card.overdue ? "overdue " : ""}{fmtDue(card.dueAt)}
            </span>
          )}
          {card.sourceChat && (
            <span className="flex items-center gap-0.5 truncate">
              <MessageCircle className="h-3 w-3" /> {card.sourceChat}
            </span>
          )}
          {card.proposedByAgent && card.confidence != null && card.stage === "triage" && (
            <span>{Math.round(card.confidence * 100)}%</span>
          )}
        </div>
      </button>

      {open && (
        <div className="mt-2 border-t pt-2 text-xs">
          {card.sourceExcerpt && <blockquote className="mb-2 whitespace-pre-wrap border-l-2 pl-2 text-muted-foreground">{card.sourceExcerpt}</blockquote>}
          {card.notes && !card.sourceExcerpt && <p className="mb-2 text-muted-foreground">{card.notes}</p>}
          <div className="flex flex-wrap gap-1">
            {href && (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border px-2 hover:bg-muted">
                <ExternalLink className="h-3 w-3" /> Open chat
              </a>
            )}
            {next && (
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={busy} onClick={() => onMove(next)}>
                {next === "done" ? <Check className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {card.stage === "triage" ? "Accept" : LABEL[next]}
              </Button>
            )}
            {card.stage !== "done" && card.stage !== "triage" && card.stage !== "waiting" && (
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={() => onMove("waiting")}>
                Waiting on
              </Button>
            )}
            {card.stage !== "done" && card.stage !== "triage" && (
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={onTomorrow}>
                Tomorrow
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-red-600" disabled={busy} onClick={onReject}>
              <Trash2 className="h-3 w-3" /> {card.stage === "triage" ? "Reject" : "Remove"}
            </Button>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
      )}
    </div>
  );
}
