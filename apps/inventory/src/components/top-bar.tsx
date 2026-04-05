"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { ChevronDown, Check } from "lucide-react";

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

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleSelect(o: Outlet) {
    setCurrentOutlet(o.name);
    setOpen(false);
    if (onOutletSwitch) {
      onOutletSwitch(o);
    } else {
      // Default behavior: reload page with new outlet context
      localStorage.setItem("celsius-active-outlet", JSON.stringify(o));
      window.location.reload();
    }
  }

  const showDropdown = outlets.length > 1;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white px-4 py-3">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <Image
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
              className="mt-0.5 flex items-center gap-1 text-sm text-terracotta"
            >
              <span>{currentOutlet}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <p className="mt-0.5 text-sm text-terracotta">{currentOutlet}</p>
          )}

          {open && (
            <div className="absolute left-0 top-full mt-1 w-64 rounded-xl border border-border bg-white shadow-lg z-50 overflow-hidden">
              {outlets.map((o) => (
                <button
                  key={o.id}
                  onClick={() => handleSelect(o)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted transition-colors"
                >
                  <span className="flex-1 font-medium text-brand-dark">{o.name}</span>
                  {o.name === currentOutlet && (
                    <Check className="h-4 w-4 text-terracotta" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
