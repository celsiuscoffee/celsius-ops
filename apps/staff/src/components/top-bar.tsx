"use client";

import { useState, useEffect, useRef } from "react";
/* eslint-disable @next/next/no-img-element */
import { ChevronDown, Check, Building2 } from "lucide-react";

interface Outlet {
  id: string;
  name: string;
  code: string;
}

interface TopBarProps {
  title: string;
  outlet?: string;
  onOutletSwitch?: (outlet: Outlet) => void;
}

export function TopBar({ title, outlet, onOutletSwitch }: TopBarProps) {
  const [currentOutlet, setCurrentOutlet] = useState(outlet ?? "");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch user session to get current outlet name + fetch outlets list
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { outletId?: string; outletName?: string; branchName?: string; id?: string }) => {
        if (!outlet) {
          setCurrentOutlet(data.outletName || data.branchName || "Unknown Outlet");
        }
        if (data.id) setUserId(data.id);
      })
      .catch(() => {});

    fetch("/api/outlets")
      .then((r) => r.json())
      .then((data: Outlet[]) => {
        if (Array.isArray(data)) setOutlets(data);
      })
      .catch(() => {});
  }, [outlet]);

  // Click-outside handled by the backdrop scrim rendered below — that
  // approach works reliably on iOS touch (mousedown doesn't always fire
  // on PWA standalone) and gives a clear "tap anywhere to dismiss" target.

  async function handleSelect(o: Outlet) {
    setCurrentOutlet(o.name);
    setOpen(false);
    if (onOutletSwitch) {
      onOutletSwitch(o);
    } else {
      // Switch outlet in session, then reload
      try {
        await fetch("/api/auth/switch-outlet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outletId: o.id }),
        });
      } catch { /* ignore */ }
      window.location.reload();
    }
  }

  const showDropdown = outlets.length > 1;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white px-4 py-3">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <img
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius Coffee"
          width={32}
          height={32}
          className="rounded-md"
        />
        <div className="relative flex-1" ref={dropdownRef}>
          <h1 className="font-heading text-lg font-semibold text-brand-dark">{title}</h1>
          {showDropdown ? (
            <button
              onClick={() => setOpen(!open)}
              className="mt-0.5 -ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-terracotta active:bg-terracotta/5"
              aria-expanded={open}
              aria-haspopup="listbox"
            >
              <span className="truncate">{currentOutlet}</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <p className="mt-0.5 text-sm text-terracotta">{currentOutlet}</p>
          )}

          {open && (
            <>
              {/* Backdrop scrim — dims content + provides reliable tap-to-
                  dismiss on iOS touch. position:fixed covers the whole
                  viewport including the title bar above. */}
              <div
                className="fixed inset-0 z-40 bg-black/20 animate-in fade-in duration-150"
                onClick={() => setOpen(false)}
                aria-hidden="true"
              />
              {/* Dropdown panel — heavier shadow + ring so it visually
                  detaches from the page underneath; larger tap targets so
                  it doesn't feel cramped on phone screens. */}
              <div
                className="absolute left-0 top-full z-50 mt-2 min-w-[280px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-150"
                role="listbox"
              >
                <div className="max-h-[60vh] overflow-y-auto py-1">
                  {outlets.map((o) => {
                    const isActive = o.name === currentOutlet;
                    return (
                      <button
                        key={o.id}
                        onClick={() => handleSelect(o)}
                        role="option"
                        aria-selected={isActive}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors active:scale-[0.99] ${
                          isActive
                            ? "bg-terracotta/5 text-terracotta-dark"
                            : "text-gray-800 hover:bg-gray-50 active:bg-gray-100"
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isActive
                              ? "bg-terracotta/15 text-terracotta-dark"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          <Building2 className="h-4 w-4" />
                        </div>
                        <span className={`flex-1 truncate ${isActive ? "font-semibold" : "font-medium"}`}>
                          {o.name}
                        </span>
                        {isActive && (
                          <Check className="h-5 w-5 shrink-0 text-terracotta" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
