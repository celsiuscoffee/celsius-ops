"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star, Coffee, Leaf, Cake, Cookie, Sandwich, Candy, CupSoda, Cherry,
  Sparkles, Croissant, Wheat, UtensilsCrossed, Utensils, FlaskConical, Plus,
  Search, X, Heart, ArrowLeft, ShoppingCart,
} from "lucide-react";
import { useOosProductIds } from "./_useOosProductIds";

/**
 * Two-column menu — sidebar pills (icon + label) on the left, product
 * list on the right with scroll-spy that highlights the active section
 * as the customer scrolls. Mirrors the SPA's menu.tsx layout but with
 * body scrolling so iOS Safari can collapse its URL bar.
 */

type Product = {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  image: string;
};

type Section = {
  id: string;
  label: string;
  icon: string;
  products: Product[];
};

const ICONS: Record<string, typeof Coffee> = {
  heart:              Heart,
  star:               Star,
  coffee:             Coffee,
  leaf:               Leaf,
  cake:               Cake,
  cookie:             Cookie,
  sandwich:           Sandwich,
  candy:              Candy,
  "cup-soda":         CupSoda,
  cherry:             Cherry,
  sparkles:           Sparkles,
  croissant:          Croissant,
  wheat:              Wheat,
  "utensils-crossed": UtensilsCrossed,
  utensils:           Utensils,
  flask:              FlaskConical,
};

const USUAL_ID = "__usual__";

export function MenuColumns({
  sections: baseSections,
  allProducts,
  children,
}: {
  sections: Section[];
  allProducts: Product[];
  children?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [usual, setUsual] = useState<Product[]>([]);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const userClickedAtRef = useRef(0);

  // Recent items "Usual" pill — same logic as apps/pickup-native/app
  // /menu.tsx. Fetches the signed-in customer's last 12 ordered items
  // and resolves them back to in-menu Product records so the section
  // renders with the same ProductRow design as the rest of the menu.
  useEffect(() => {
    let phone: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { phone?: string | null } };
        phone = parsed.state?.phone ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!phone) return;
    fetch(`/api/loyalty/recent-items?phone=${encodeURIComponent(phone)}&limit=12`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const items = (Array.isArray(data) ? data : (data?.items ?? [])) as Array<{
          id: string;
        }>;
        const byId = new Map(allProducts.map((p) => [p.id, p]));
        const resolved: Product[] = [];
        for (const it of items) {
          const p = byId.get(it.id);
          if (p) resolved.push(p);
        }
        setUsual(resolved);
      })
      .catch(() => {
        /* ignore */
      });
  }, [allProducts]);

  // Per-outlet out-of-stock (POS "86") product ids, kept live via realtime.
  // The web menu had ignored these entirely — now it drops them like the
  // native app does.
  const oos = useOosProductIds();

  // Prepend the Usual section above Best Sellers + categories when the customer
  // has resolved recent items, and strip any item that's 86'd at their outlet
  // (a category emptied by 86s disappears too).
  const sections: Section[] = useMemo(() => {
    const strip = (ps: Product[]) => (oos.size === 0 ? ps : ps.filter((p) => !oos.has(p.id)));
    const base = baseSections
      .map((s) => ({ ...s, products: strip(s.products) }))
      .filter((s) => s.products.length > 0);
    const u = strip(usual);
    return u.length > 0
      ? [{ id: USUAL_ID, label: "Your usual", products: u, icon: "heart" }, ...base]
      : base;
  }, [baseSections, usual, oos]);

  const [active, setActive] = useState(sections[0]?.id ?? "");

  // Measured height of the sticky chrome (header + outlet row + the
  // CONDITIONAL reserved-voucher banner). The rail's sticky offset + the
  // scroll-spy math key off this so they stay correct whether or not the
  // banner is showing. A hardcoded offset let the banner (z-10) overlap the
  // category rail + product list whenever a voucher was locked in.
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chromeH, setChromeH] = useState(150);
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const update = () => setChromeH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Search results — flat list across all sections, deduped by product
  // id (Best Sellers + the original category section would otherwise
  // surface the same product twice).
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<string>();
    const matches: Product[] = [];
    for (const s of sections) {
      for (const p of s.products) {
        if (seen.has(p.id)) continue;
        const hay = `${p.name} ${p.description ?? ""}`.toLowerCase();
        if (hay.includes(q)) {
          seen.add(p.id);
          matches.push(p);
        }
      }
    }
    return matches;
  }, [query, sections]);

  useEffect(() => {
    if (sections.length === 0) return;
    function onScroll() {
      if (Date.now() - userClickedAtRef.current < 600) return;
      let nextActive = sections[0]?.id ?? "";
      const offset = chromeH + 12;
      for (const s of sections) {
        const el = sectionRefs.current[s.id];
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - offset <= 0) nextActive = s.id;
        else break;
      }
      setActive((prev) => (prev !== nextActive ? nextActive : prev));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections, chromeH]);

  const onPickPill = (id: string) => {
    setActive(id);
    userClickedAtRef.current = Date.now();
    const el = sectionRefs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - chromeH - 8;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <>
      {/* Chrome block — header + outlet picker (+ reserved-voucher
          banner) freeze together at the top so the outlet stays in view
          while the product list scrolls under it. */}
      <div ref={chromeRef} className="sticky top-0 z-10">
      {/* Espresso header. Search is a toggle (matching
          apps/pickup-native/app/menu.tsx:375-430): the title row shows
          a Search icon + Cart; tapping Search swaps the whole bar into
          an inline white-tinted field with a Cancel button. */}
      <header
        className="bg-[#160800] text-white px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        {searchOpen ? (
          <div className="flex items-center gap-3">
            <div
              className="flex-1 flex items-center gap-2 rounded-full px-3 py-2"
              style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
            >
              <Search size={16} color="rgba(255,255,255,0.7)" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search menu…"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/50"
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="active:opacity-60"
                  aria-label="Clear search"
                >
                  <X size={16} color="rgba(255,255,255,0.7)" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
              className="text-sm font-medium text-white active:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link href="/" className="-ml-1 p-1 active:opacity-60" aria-label="Back to home">
              <ArrowLeft size={20} color="#FFFFFF" />
            </Link>
            <h1 className="flex-1 font-peachi font-bold text-[22px] truncate">QR Table Order</h1>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="p-1 active:opacity-60"
              aria-label="Search menu"
            >
              <Search size={20} color="rgba(255,255,255,0.85)" />
            </button>
            <Link href="/cart" className="p-1 active:opacity-60" aria-label="Cart">
              <ShoppingCart size={20} color="rgba(255,255,255,0.85)" />
            </Link>
          </div>
        )}
      </header>

      {children}
      </div>

      {searchResults ? (
        <div className="px-3 pt-4">
          <p className="text-[11px] text-[#8E8E93] uppercase tracking-widest mb-2 px-1">
            {searchResults.length} {searchResults.length === 1 ? "result" : "results"} for &ldquo;{query}&rdquo;
          </p>
          {searchResults.length === 0 ? (
            <p className="py-12 text-center text-sm text-[#8E8E93]">No matches</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {searchResults.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </ul>
          )}
          <div className="h-8" />
        </div>
      ) : (

    <div className="flex" style={{ minHeight: "calc(100dvh - 200px)" }}>
      <aside
        className="flex-shrink-0 bg-white overflow-y-auto w-[76px] min-[420px]:w-24"
        style={{
          position: "sticky",
          top: `${chromeH}px`,
          alignSelf: "flex-start",
          height: "calc(100dvh - 140px)",
          WebkitOverflowScrolling: "touch",
        }}
        aria-label="Categories"
      >
        <ul
          className="flex flex-col"
          style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 8, paddingBottom: 180, gap: 6 }}
        >
          {sections.map((s) => {
            const Icon = ICONS[s.icon] ?? Coffee;
            const on = active === s.id;
            return (
              <li key={s.id} className="flex justify-center">
                <button
                  type="button"
                  onClick={() => onPickPill(s.id)}
                  className="flex flex-col items-center justify-center gap-1 rounded-2xl active:opacity-70 w-[68px] min-[420px]:w-[88px]"
                  style={{
                    height: 78,
                    paddingLeft: 4,
                    paddingRight: 4,
                    backgroundColor: on ? "#160800" : "transparent",
                  }}
                  aria-current={on ? "true" : undefined}
                >
                  <Icon
                    size={22}
                    color={on ? "#FFFFFF" : "#6E6E73"}
                    strokeWidth={1.75}
                    fill={on && s.icon === "star" ? "#FFFFFF" : "transparent"}
                  />
                  <span
                    className="text-[11px] text-center leading-[13px]"
                    style={{ color: on ? "#FFFFFF" : "#160800", fontWeight: 600 }}
                  >
                    {s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex-1 min-w-0">
        {sections.map((s) => (
          <section
            key={s.id}
            ref={(el) => {
              sectionRefs.current[s.id] = el;
            }}
            className="px-3 pt-4"
          >
            <div className="flex items-baseline gap-2 mb-2 px-1">
              <h2 className="font-peachi font-bold text-[20px] flex-1">{s.label}</h2>
              <span className="text-[11px] tracking-widest text-[#8E8E93] font-bold">
                {s.products.length}
              </span>
            </div>
            <ul className="flex flex-col gap-3">
              {s.products.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </ul>
          </section>
        ))}
        <div className="h-8" />
      </div>
    </div>
      )}
    </>
  );
}

function ProductRow({ product }: { product: Product }) {
  // Sizing mirrors apps/pickup-native/app/menu.tsx ProductRow (p-2.5,
  // gap-2.5, 88×88 image with 24px radius, 28×28 add button, Plus 14).
  return (
    <li>
      <Link
        href={`/product/${product.id}`}
        className="block bg-white rounded-2xl active:opacity-80"
        style={{
          border: "1px solid rgba(26, 2, 0, 0.10)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <div className="flex gap-[10px] p-[10px]">
          <div
            className="relative flex-shrink-0 overflow-hidden bg-[#F2EDE5]"
            style={{ width: 88, height: 88, borderRadius: 24 }}
          >
            {product.image ? (
              <Image src={product.image} alt={product.name} fill sizes="88px" className="object-cover" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between" style={{ paddingTop: 2, paddingBottom: 2 }}>
            <div>
              <p
                className="font-peachi font-bold text-[14px] leading-[18px] text-[#160800]"
              >
                {product.name}
              </p>
              {product.description ? (
                <p className="text-[11px] mt-0.5 leading-[14px] text-[#6E6E73] line-clamp-2">
                  {product.description}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[14px] text-[#A2492C] font-bold">
                RM{product.basePrice.toFixed(2)}
              </span>
              <span
                className="rounded-full bg-[#160800] flex items-center justify-center flex-shrink-0"
                style={{ width: 28, height: 28 }}
              >
                <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
