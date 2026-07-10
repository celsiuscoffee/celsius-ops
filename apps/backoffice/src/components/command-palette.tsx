"use client";

// ⌘K command palette — opens with Cmd/Ctrl+K from anywhere in the backoffice.
// Two result groups:
//   Pages     — every nav destination the user can access (from lib/nav.tsx),
//               searched by page name, section, or subgroup. The fastest way
//               to reach a page without hunting through the sidebar.
//   Employees — jump to an HR profile by name, phone, or IC.

import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { NAV_SECTIONS, canAccess, type NavItem, type UserProfile } from "@/lib/nav";

type Employee = {
  id: string;
  name: string;
  fullName: string | null;
  role: string;
  phone: string | null;
  outlet: { name: string } | null;
  status?: string;
  hrProfile?: { ic_number?: string | null; position?: string | null; profile_photo_url?: string | null } | null;
  profile_photo_url?: string | null;
};

type PageEntry = {
  label: string;
  href: string;
  icon: React.ReactNode;
  moduleKey?: string;
  // "Section · Subgroup" breadcrumb shown under the label
  crumb: string;
};

// Flatten the nav tree once at module scope — it's static config.
const PAGE_INDEX: PageEntry[] = NAV_SECTIONS.flatMap((section) => {
  const flat: { item: NavItem; crumb: string }[] = [];
  for (const item of section.items ?? []) flat.push({ item, crumb: section.label });
  for (const sg of section.subgroups ?? [])
    for (const item of sg.items) flat.push({ item, crumb: `${section.label} · ${sg.label}` });
  return flat.map(({ item, crumb }) => ({ ...item, crumb }));
});

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: user } = useFetch<UserProfile>("/api/auth/me");

  // Fetch the employee directory once on first open. Keep it cached for the
  // session — typical company list is < 500 rows so a client-side fuzzy filter
  // is fast and avoids a per-keystroke server round trip.
  useEffect(() => {
    if (!open || employees.length > 0 || loading) return;
    setLoading(true);
    fetch("/api/hr/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d?.employees || []))
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, [open, employees.length, loading]);

  // Global ⌘K / Ctrl+K handler. Toggles open. Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setHighlight(0);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Pages the current user can open. Only shown once they start typing —
  // the empty state stays a browse-able employee list, matching old behavior.
  const pages = useMemo(() => {
    if (!q.trim() || !user) return [];
    const needle = q.toLowerCase();
    return PAGE_INDEX.filter(
      (p) =>
        canAccess(user, p.moduleKey) &&
        (p.label.toLowerCase().includes(needle) || p.crumb.toLowerCase().includes(needle)),
    ).slice(0, 6);
  }, [q, user]);

  // Match name / fullName / phone / IC. Case-insensitive substring.
  const filtered = useMemo(() => {
    if (!q.trim()) return employees.slice(0, 12);
    const needle = q.toLowerCase();
    return employees
      .filter((e) => {
        if (e.status && e.status !== "ACTIVE" && e.status !== "INVITED") return false;
        const name = (e.fullName || e.name || "").toLowerCase();
        const phone = (e.phone || "").toLowerCase();
        const ic = (e.hrProfile?.ic_number || "").toLowerCase();
        return name.includes(needle) || phone.includes(needle) || ic.includes(needle);
      })
      .slice(0, 12);
  }, [q, employees]);

  // One flat keyboard-navigation order: pages first, then employees.
  const total = pages.length + filtered.length;

  // Reset highlight when query changes
  useEffect(() => { setHighlight(0); }, [q]);

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
    setQ("");
  };

  const selectIndex = (i: number) => {
    if (i < pages.length) {
      go(pages[i].href);
    } else {
      const emp = filtered[i - pages.length];
      if (emp) go(`/hr/employees/${emp.id}`);
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectIndex(highlight);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search pages, or employees by name, phone, or IC…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
          <kbd className="hidden rounded border bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500 sm:inline">
            ESC
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {pages.length > 0 && (
            <>
              <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Pages
              </p>
              <ul className="pb-1">
                {pages.map((p, i) => {
                  const isActive = i === highlight;
                  return (
                    <li key={p.href}>
                      <button
                        onClick={() => go(p.href)}
                        onMouseEnter={() => setHighlight(i)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                          isActive ? "bg-terracotta/10" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                          {p.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{p.label}</span>
                          <span className="block truncate text-[10px] text-gray-500">{p.crumb}</span>
                        </span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-gray-400" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading directory…
            </div>
          ) : total === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">
              {q ? `No matches for "${q}"` : "No employees yet"}
            </p>
          ) : (
            filtered.length > 0 && (
              <>
                {pages.length > 0 && (
                  <p className="border-t px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Employees
                  </p>
                )}
                <ul className="py-1">
                  {filtered.map((e, i) => {
                    const idx = pages.length + i;
                    const photo = e.profile_photo_url || e.hrProfile?.profile_photo_url || null;
                    const isActive = idx === highlight;
                    return (
                      <li key={e.id}>
                        <button
                          onClick={() => go(`/hr/employees/${e.id}`)}
                          onMouseEnter={() => setHighlight(idx)}
                          className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                            isActive ? "bg-terracotta/10" : "hover:bg-gray-50"
                          }`}
                        >
                          {photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo}
                              alt=""
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600">
                              {(e.fullName || e.name || "?").charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {e.fullName || e.name}
                            </span>
                            <span className="block truncate text-[10px] text-gray-500">
                              {[e.role, e.hrProfile?.position, e.outlet?.name].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {e.phone && (
                            <span className="hidden text-[10px] text-gray-400 sm:inline">{e.phone}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-gray-400">
          <span>
            <kbd className="rounded border bg-gray-100 px-1 font-mono">↑</kbd>{" "}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">↓</kbd> navigate ·{" "}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded border bg-gray-100 px-1 font-mono">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}
