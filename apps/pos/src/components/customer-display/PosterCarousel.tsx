"use client";

import { useEffect, useRef, useState } from "react";

export type DisplayPoster = {
  id: string;
  imageUrl: string;
  title: string | null;
  deeplink: string | null;
  durationMs: number;
};

type Props = {
  posters: DisplayPoster[];
  /**
   * Aspect ratio (width / height). Matches the backoffice POS placement
   * template (16:7) so cropped uploads render exactly as designed.
   */
  aspect?: number;
};

/**
 * Web equivalent of the pickup-native PosterCarousel. Auto-advances
 * on each poster's durationMs (default 4500ms). Renders dots when
 * 2+ posters, swallows taps (no deeplink behavior on a customer-facing
 * read-only display — the cashier owns interactions).
 */
export function PosterCarousel({ posters, aspect = 16 / 7 }: Props) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  useEffect(() => {
    if (posters.length <= 1) return;
    const dur = posters[activeRef.current]?.durationMs ?? 4500;
    const t = setTimeout(() => {
      const next = (activeRef.current + 1) % posters.length;
      activeRef.current = next;
      setActive(next);
    }, dur);
    return () => clearTimeout(t);
  }, [active, posters]);

  // Reset to slide 0 if the poster list changes underneath us.
  useEffect(() => {
    activeRef.current = 0;
    setActive(0);
  }, [posters.map((p) => p.id).join(",")]);

  if (posters.length === 0) return null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl bg-[#160800]"
      style={{ aspectRatio: aspect }}
    >
      {posters.map((p, i) => (
        <img
          key={p.id}
          src={p.imageUrl}
          alt={p.title ?? ""}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
          style={{ opacity: i === active ? 1 : 0 }}
        />
      ))}

      {posters.length > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
          {posters.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === active ? 18 : 6,
                backgroundColor: i === active ? "#fff" : "rgba(255,255,255,0.55)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
