"use client";

// "Needs you" on Today: the five most urgent Inbox items, Act now first, then
// the ringgit at stake (Gosamē UI Office dashboard pattern, Celsius brand).
// Reads the same GET /api/inbox as the Inbox page and the rail count; SWR shares
// the one request between them.

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { sortInbox, type InboxResponse } from "@/lib/inbox/types";
import { formatInboxAmount } from "@/lib/inbox/format";

export function useInbox() {
  return useFetch<InboxResponse>("/api/inbox", { refreshInterval: 120_000, revalidateOnFocus: true });
}

export function NeedsYou() {
  const { data, isLoading } = useInbox();
  const items = sortInbox(data?.items ?? []);
  const top = items.slice(0, 5);
  const now = data?.counts.now ?? 0;

  return (
    <section aria-label="Needs you" className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 text-base font-semibold text-text">
        Needs you
        {now > 0 ? (
          <span className="rounded-full bg-danger-soft px-2 text-xs font-medium leading-5 text-danger-text">{now} urgent</span>
        ) : items.length > 0 ? (
          <span className="rounded-full bg-warn-soft px-2 text-xs font-medium leading-5 text-warn-text">{items.length}</span>
        ) : null}
      </h2>
      {isLoading ? (
        <p className="border-t border-line px-4 py-4 text-[13px] text-text-2">Checking every area…</p>
      ) : top.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-line px-4 py-4 text-[13px] text-text-2">
          <CheckCircle2 className="size-4 text-ok-text" aria-hidden /> Nothing needs you right now.
        </p>
      ) : (
        top.map((i) => (
          <Link key={i.id} href={i.href} className="flex min-h-14 items-start gap-2.5 border-t border-line px-4 py-2.5 hover:bg-sunken/60">
            {i.when === "now" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger-text" aria-label="Act now" />
            ) : (
              <Clock className="mt-0.5 size-4 shrink-0 text-warn-text" aria-label={i.when === "today" ? "Today" : "Soon"} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-[18px] text-text">{i.title}</p>
              <p className="mt-0.5 truncate text-xs text-text-3">
                {i.from}
                {i.amountRM != null ? ` · ${formatInboxAmount(i.amountRM)}` : ""}
              </p>
            </div>
          </Link>
        ))
      )}
      <Link href="/inbox" className="mt-auto flex min-h-11 items-center gap-1 border-t border-line px-4 text-[13px] font-medium text-text hover:bg-sunken/60">
        {items.length > top.length ? `See all ${items.length} in the Inbox` : "Open the Inbox"} <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}
