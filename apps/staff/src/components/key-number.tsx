import Link from "next/link";
import type { ReactNode } from "react";

// One key number (Celsius UI, as in the back office): label, value, and what
// it is read against. At most four on a screen; two across on a phone.
export function KeyNumber({ label, value, note, tone, href }: {
  label: string;
  value: string | null;
  note?: ReactNode;
  tone?: "warn" | "danger" | "ok";
  href?: string;
}) {
  const toneCls = tone === "warn" ? "text-warn-text" : tone === "danger" ? "text-danger-text" : tone === "ok" ? "text-ok-text" : "text-text";
  const body = (
    <>
      <p className="text-[12px] font-medium text-text-2">{label}</p>
      {value === null
        ? <div className="mt-1.5 h-7 w-16 animate-pulse rounded bg-sunken" />
        : <p title={value} className={`mt-0.5 truncate text-[22px] font-semibold leading-8 ${toneCls}`}>{value}</p>}
      {note && <p className="mt-0.5 text-[12px] text-text-3">{note}</p>}
    </>
  );
  const box = "block rounded-card border border-line bg-surface p-3.5";
  return href
    ? <Link href={href} className={box + " active:bg-sunken"}>{body}</Link>
    : <div className={box}>{body}</div>;
}
