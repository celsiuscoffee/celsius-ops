"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star, Coffee, Leaf, Cake, Cookie, Sandwich, Candy, CupSoda, Cherry,
  Sparkles, Croissant, Wheat, UtensilsCrossed, Utensils, FlaskConical, Plus,
} from "lucide-react";

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

export function MenuColumns({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const userClickedAtRef = useRef(0);

  useEffect(() => {
    if (sections.length === 0) return;
    function onScroll() {
      if (Date.now() - userClickedAtRef.current < 600) return;
      let nextActive = sections[0]?.id ?? "";
      const offset = 160;
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
  }, [sections]);

  const onPickPill = (id: string) => {
    setActive(id);
    userClickedAtRef.current = Date.now();
    const el = sectionRefs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 110;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <div className="flex" style={{ minHeight: "calc(100dvh - 200px)" }}>
      <aside
        className="w-[64px] flex-shrink-0 bg-[#F7F4F0] border-r border-[#E8E1D8] sticky overflow-y-auto"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 100px)",
          alignSelf: "flex-start",
          maxHeight: "calc(100dvh - 100px)",
        }}
        aria-label="Categories"
      >
        <ul className="flex flex-col gap-1.5 p-1 pt-2">
          {sections.map((s) => {
            const Icon = ICONS[s.icon] ?? Coffee;
            const on = active === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPickPill(s.id)}
                  className="w-full flex flex-col items-center gap-1 py-2 px-1 rounded-2xl active:opacity-70"
                  style={{ backgroundColor: on ? "#160800" : "transparent" }}
                  aria-current={on ? "true" : undefined}
                >
                  <Icon
                    size={16}
                    color={on ? "#FFFFFF" : "#6E6E73"}
                    strokeWidth={1.75}
                    fill={on && s.icon === "star" ? "#FFFFFF" : "transparent"}
                  />
                  <span
                    className="text-[9px] text-center leading-[11px]"
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
                <li key={p.id}>
                  <Link
                    href={`/product/${p.id}`}
                    className="block bg-white rounded-2xl border border-[#EBE5DE] active:opacity-80"
                    style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
                  >
                    <div className="flex items-center gap-3 p-3">
                      <div className="relative w-[72px] h-[72px] flex-shrink-0 rounded-xl overflow-hidden bg-[#F2EDE5]">
                        {p.image ? (
                          <Image src={p.image} alt={p.name} fill sizes="72px" className="object-cover" />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{p.name}</p>
                        {p.description ? (
                          <p className="text-[11px] text-[#6E6E73] mt-0.5 line-clamp-2">
                            {p.description}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm text-[#A2492C] font-bold">
                          RM{p.basePrice.toFixed(2)}
                        </p>
                      </div>
                      <span className="h-9 w-9 rounded-full bg-[#160800] flex items-center justify-center flex-shrink-0">
                        <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="h-8" />
      </div>
    </div>
  );
}
