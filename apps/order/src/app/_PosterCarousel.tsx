"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

/**
 * Auto-rotating poster carousel for the home hero. Plain HTML, no
 * react-native-web — fades between posters every ~5s. Falls back to
 * the first poster (static) if reduced-motion is preferred.
 */
type Poster = {
  id: string;
  image_url: string;
  title: string | null;
  deeplink: string | null;
};

// Best-effort event log → /api/poster-tap so the home autopilot can attribute
// the resulting order's AOV to this poster ('tap') and compute CTR
// ('impression'). keepalive lets a tap survive the navigation the <Link>
// triggers; never blocks the tap.
function logPosterEvent(posterId: string, deeplink: string | null, eventType: "tap" | "impression") {
  try {
    let loyaltyId: string | null = null;
    const raw = localStorage.getItem("celsius-pickup");
    if (raw) loyaltyId = (JSON.parse(raw)?.state?.loyaltyId as string | undefined) ?? null;
    void fetch("/api/poster-tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterId, placement: "home", deeplink, loyaltyId, eventType }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never block navigation */
  }
}

// One impression per poster per page view (deduped across the personalized
// swap) — the CTR denominator for the autopilot's home learning signal.
const seenPosters = new Set<string>();
function logImpressions(list: Poster[]) {
  for (const p of list) {
    if (seenPosters.has(p.id)) continue;
    seenPosters.add(p.id);
    logPosterEvent(p.id, p.deeplink, "impression");
  }
}

export function PosterCarousel({ posters }: { posters: Poster[] }) {
  const [idx, setIdx] = useState(0);
  // Server render gives a tight, day-part set (same for everyone, cached). Once
  // mounted, if the customer is signed in we swap in a PERSONALIZED set
  // (high-AOV items they haven't tried) from /api/home-posters?member=. Falls
  // back silently to the server set for guests or on any error.
  const [list, setList] = useState<Poster[]>(posters);

  useEffect(() => {
    let loyaltyId: string | null = null;
    try {
      const raw = localStorage.getItem("celsius-pickup");
      if (raw) loyaltyId = (JSON.parse(raw)?.state?.loyaltyId as string | undefined) ?? null;
    } catch { /* ignore */ }
    if (!loyaltyId) return;
    let cancelled = false;
    fetch(`/api/home-posters?member=${encodeURIComponent(loyaltyId)}`)
      .then((r) => r.json())
      .then((j) => {
        const next = Array.isArray(j?.posters)
          ? (j.posters as { id: string; imageUrl: string; title: string | null; deeplink: string | null }[])
              .map((p) => ({ id: p.id, image_url: p.imageUrl, title: p.title, deeplink: p.deeplink }))
          : [];
        if (!cancelled && next.length) { setList(next); setIdx(0); }
      })
      .catch(() => { /* keep server set */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    logImpressions(list);
  }, [list]);

  useEffect(() => {
    if (list.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % list.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [list.length]);

  if (list.length === 0) {
    return <div className="relative w-full aspect-[1.07] bg-[#160800]" />;
  }

  return (
    <div className="relative w-full aspect-[1.07] bg-[#160800] overflow-hidden">
      {list.map((p, i) => (
        <Link
          key={p.id}
          href={p.deeplink || "/menu"}
          onClick={() => logPosterEvent(p.id, p.deeplink, "tap")}
          className="absolute inset-0"
          style={{
            opacity: i === idx ? 1 : 0,
            transition: "opacity 700ms ease",
          }}
          aria-hidden={i !== idx}
        >
          <Image
            src={p.image_url}
            alt={p.title ?? ""}
            fill
            priority={i === 0}
            sizes="(max-width: 430px) 100vw, 430px"
            className="object-cover"
          />
        </Link>
      ))}
      {list.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
          {list.map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: i === idx ? 16 : 6,
                height: 6,
                backgroundColor: i === idx ? "#FFFFFF" : "rgba(255,255,255,0.45)",
                transition: "width 300ms ease",
              }}
              aria-hidden
            />
          ))}
        </div>
      )}
    </div>
  );
}
