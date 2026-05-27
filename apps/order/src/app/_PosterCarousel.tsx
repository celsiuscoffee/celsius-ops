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

export function PosterCarousel({ posters }: { posters: Poster[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (posters.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % posters.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [posters.length]);

  if (posters.length === 0) {
    return <div className="relative w-full aspect-[1.07] bg-[#160800]" />;
  }

  return (
    <div className="relative w-full aspect-[1.07] bg-[#160800] overflow-hidden">
      {posters.map((p, i) => (
        <Link
          key={p.id}
          href={p.deeplink || "/menu"}
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
      {posters.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
          {posters.map((_, i) => (
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
