"use client";

// Inbox: every decision waiting on this person, one queue grouped by when it is
// needed (Gosamē UI Office "Inbox" page type, Celsius brand). v1 is read-only:
// the open card shows what is waiting and why, and Open goes to the page where
// it is decided today (lib/inbox/types.ts).

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Info, Loader2, RefreshCw } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import {
  WHEN_LABEL,
  WHEN_ORDER,
  sortInbox,
  type InboxArea,
  type InboxItem,
  type InboxResponse,
  type InboxWhen,
} from "@/lib/inbox/types";
import { formatInboxAmount, formatInboxTime } from "@/lib/inbox/format";

const WHEN_ICON: Record<InboxWhen, React.ReactNode> = {
  now: <AlertTriangle className="size-3.5 text-danger-text" aria-hidden />,
  today: <Clock className="size-3.5 text-warn-text" aria-hidden />,
  week: <Clock className="size-3.5 text-text-3" aria-hidden />,
  later: <Info className="size-3.5 text-text-3" aria-hidden />,
};

export default function InboxPage() {
  const { data, isLoading, mutate } = useFetch<InboxResponse>("/api/inbox");
  const [area, setArea] = useState<InboxArea | "All">("All");
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => sortInbox(data?.items ?? []), [data]);
  const areas = useMemo(() => {
    const m = new Map<InboxArea, number>();
    for (const i of items) m.set(i.area, (m.get(i.area) ?? 0) + 1);
    return [...m.entries()];
  }, [items]);
  const shown = area === "All" ? items : items.filter((i) => i.area === area);
  const open = shown.find((i) => i.id === openId) ?? shown[0];
  const nowCount = items.filter((i) => i.when === "now").length;

  return (
    <div className="mx-auto max-w-[1240px] space-y-4 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
            {isLoading ? "Loading…" : `${items.length} waiting${nowCount ? ` · ${nowCount} need you now` : ""}`}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-[30px] text-text">Everything waiting on you, in one place</h1>
          <p className="mt-1.5 text-sm text-text-2">Approvals from across the office. Open one to decide it on its own page.</p>
        </div>
        <button
          type="button"
          onClick={() => mutate()}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line-2 px-3 text-[13px] font-medium text-text hover:bg-sunken"
        >
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>

      {data?.unavailable?.length ? (
        <p className="flex items-center gap-2 rounded-card bg-warn-soft px-4 py-2.5 text-[13px] text-warn-text">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Couldn&apos;t check {data.unavailable.join(", ")} just now, so the list may be short. Refresh to try again.
        </p>
      ) : null}

      {areas.length > 1 && (
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label="Filter by area">
          {[["All", items.length] as const, ...areas].map(([a, n]) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={area === a}
              onClick={() => { setArea(a as InboxArea | "All"); setOpenId(null); }}
              className={
                "h-8 shrink-0 rounded-full border px-3 text-[13px] transition-colors max-md:h-10 " +
                (area === a ? "border-text bg-raised font-semibold text-text" : "border-line-2 text-text-2 hover:text-text")
              }
            >
              {a} <span className="font-mono text-xs text-text-3">{n}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-card border border-line bg-surface py-16 text-sm text-text-2">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking every area…
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface py-16 text-center">
          <CheckCircle2 className="size-8 text-ok-text" aria-hidden />
          <p className="text-[15px] font-semibold text-text">Nothing needs you right now.</p>
          <p className="text-[13px] text-text-2">New approvals show here as they arrive.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
          <section aria-label="Waiting" className="overflow-hidden rounded-card border border-line bg-surface">
            {WHEN_ORDER.map((w) => {
              const group = shown.filter((i) => i.when === w);
              if (!group.length) return null;
              return (
                <div key={w}>
                  <h2 className={"flex items-center gap-1.5 px-4 pt-3.5 pb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] " + (w === "now" ? "text-danger-text" : "text-text-3")}>
                    {WHEN_ICON[w]}{WHEN_LABEL[w]} · {group.length}
                  </h2>
                  {group.map((i) => (
                    <Row key={i.id} item={i} open={open?.id === i.id} onOpen={() => setOpenId(i.id)} />
                  ))}
                </div>
              );
            })}
          </section>
          {open && <Card item={open} />}
        </div>
      )}
    </div>
  );
}

function Row({ item, open, onOpen }: { item: InboxItem; open: boolean; onOpen: () => void }) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-text-3">{item.from}</p>
        <p className="mt-0.5 text-[13px] font-medium leading-[18px] text-text">{item.title}</p>
      </div>
      {item.amountRM != null && (
        <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-text-2">{formatInboxAmount(item.amountRM)}</span>
      )}
    </>
  );
  const cls = "flex w-full items-start gap-3 border-t border-line px-4 py-3 text-left max-md:min-h-14";
  return (
    <>
      {/* Desktop: select into the side card */}
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? "true" : undefined}
        className={cls + " hidden lg:flex " + (open ? "bg-sel shadow-[inset_2px_0_0_var(--brand)]" : "hover:bg-sunken/60")}
      >
        {body}
      </button>
      {/* Phone and tablet: go straight to where it is decided */}
      <Link href={item.href} className={cls + " lg:hidden active:bg-sunken"}>
        {body}
        <ArrowRight className="mt-1 size-4 shrink-0 text-text-3" aria-hidden />
      </Link>
    </>
  );
}

function Card({ item }: { item: InboxItem }) {
  const tone =
    item.when === "now" ? "bg-danger-soft text-danger-text" : item.when === "today" ? "bg-warn-soft text-warn-text" : "bg-sunken text-text-2";
  return (
    <section aria-label="Open decision" className="sticky top-20 hidden rounded-card border border-line bg-surface p-6 lg:block">
      <span className={"inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-medium " + tone}>
        {WHEN_ICON[item.when]}{WHEN_LABEL[item.when]}
        {item.at ? ` · ${formatInboxTime(item.at)}` : ""}
      </span>
      <h2 className="mt-2.5 text-xl font-semibold leading-[26px] text-text">{item.title}</h2>
      <p className="mt-1 text-xs text-text-3">{item.from}</p>
      {(item.why?.length || item.amountRM != null) && (
        <dl className="mt-4 space-y-2 text-[13px]">
          {item.amountRM != null && (
            <div className="flex gap-4">
              <dt className="w-24 shrink-0 text-text-3">Amount</dt>
              <dd className="font-mono tabular-nums text-text">{formatInboxAmount(item.amountRM)}</dd>
            </div>
          )}
          {item.why?.map((w, n) => (
            <div key={n} className="flex gap-4">
              <dt className="w-24 shrink-0 text-text-3">{n === 0 ? "Why" : ""}</dt>
              <dd className="text-text">{w}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-5">
        <Link
          href={item.href}
          className="inline-flex h-8 items-center gap-1.5 rounded-ctl bg-ink px-3 text-[13px] font-medium text-on-ink hover:bg-ink-hover"
        >
          {item.hrefLabel} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
