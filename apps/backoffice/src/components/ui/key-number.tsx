import Link from "next/link";
import type { ReactNode } from "react";

// One key number on a Celsius UI page: label, value, and the reference it is
// read against. At most four per page. `value: null` shows the loading bar;
// `word` sets a name (a reason, an item) in the text face instead of mono.
export function KeyNumber({ label, value, note, tone, word, href }: {
  label: string;
  value: string | null;
  note: ReactNode;
  tone?: "warn";
  word?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[12px] font-medium text-text-2">{label}</p>
      {value === null
        ? <div className="mt-1.5 h-8 w-24 animate-pulse rounded bg-sunken" />
        : <p title={value} className={"mt-1 truncate text-[21px] font-semibold leading-8 sm:text-[26px] " + (word ? "" : "font-mono ") + (tone === "warn" ? "text-warn-text" : "text-text")}>{value}</p>}
      <p className="mt-1 text-[12px] text-text-3">{note}</p>
    </>
  );
  const box = "rounded-card border border-line bg-surface p-4";
  return href
    ? <Link href={href} className={box + " transition-colors hover:border-line-2"}>{body}</Link>
    : <div className={box}>{body}</div>;
}
