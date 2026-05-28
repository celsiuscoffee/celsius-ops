"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Coffee, Clock, MapPin, Share2, ChevronLeft } from "lucide-react";

/**
 * Coffee Wrapped — annual recap, Spotify-style. Port of
 * apps/pickup-native/app/wrapped.tsx: giant cups headline, BigCard
 * stat rows (favourite drink/hour, outlets, streak), a "The damage"
 * spend/saved card, and a Share pill. Espresso bg + amber accents.
 * Wired to /api/loyalty/me/wrapped with the session token.
 */
const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Wrapped = {
  year: number;
  summary: {
    total_orders: number;
    total_spent_sen: number;
    total_saved_sen: number;
    distinct_outlets: number;
    distinct_products: number;
    longest_streak_weeks: number;
  };
  favorites: {
    product_name: string | null;
    product_count: number;
    hour: number | null;
    month: number | null;
  };
};

type Persisted = { state?: { sessionToken?: string | null; phone?: string | null } };

function formatHour(h: number | null): string {
  if (h === null) return "—";
  const local = (h + 8) % 24; // UTC → MYT
  const ampm = local < 12 ? "AM" : "PM";
  const h12 = local % 12 === 0 ? 12 : local % 12;
  return `${h12}${ampm}`;
}

function formatRM(sen: number): string {
  return `RM${(sen / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function WrappedView() {
  const router = useRouter();
  const year = new Date().getFullYear();
  const [data, setData] = useState<Wrapped | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    let phone: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const s = (JSON.parse(raw) as Persisted).state;
        token = s?.sessionToken ?? null;
        phone = s?.phone ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!token && !phone) {
      setLoaded(true);
      return;
    }
    fetch(`/api/loyalty/me/wrapped?year=${year}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData((d ?? null) as Wrapped | null))
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, [year]);

  const share = async () => {
    if (!data) return;
    const lines = [
      `My Celsius Coffee Wrapped ${data.year} ☕`,
      `${data.summary.total_orders} cups · ${data.summary.distinct_outlets} outlets`,
    ];
    if (data.favorites.product_name) lines.push(`Favourite: ${data.favorites.product_name}`);
    if (data.summary.longest_streak_weeks > 0)
      lines.push(`Longest streak: ${data.summary.longest_streak_weeks} weeks 🔥`);
    lines.push("\nhttps://celsiuscoffee.com");
    try {
      if (navigator.share) await navigator.share({ text: lines.join("\n") });
      else await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* dismissed */
    }
  };

  const total = data?.summary.total_orders ?? 0;

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: "#1A0200" }}>
      {/* Top bar */}
      <div
        className="flex items-center px-4 pb-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center justify-center active:opacity-60"
          style={{ width: 32, height: 32 }}
          aria-label="Back"
        >
          <ChevronLeft size={22} color="#FBBF24" />
        </button>
        <span
          className="uppercase"
          style={{ color: "rgba(251,191,36,0.7)", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginLeft: 4 }}
        >
          Wrapped {year}
        </span>
      </div>

      {!loaded ? (
        <div className="flex items-center justify-center" style={{ minHeight: "60vh", color: "#FBBF24" }}>
          Loading…
        </div>
      ) : !data || total === 0 ? (
        <div className="flex flex-col items-center justify-center px-8 text-center" style={{ minHeight: "60vh" }}>
          <Coffee size={48} color="#FBBF24" strokeWidth={1.5} />
          <p className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 24, marginTop: 16 }}>
            You&apos;re still warming up
          </p>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 8, lineHeight: "20px" }}>
            Place your first order to start brewing your {year} Wrapped story ☕
          </p>
        </div>
      ) : (
        <div style={{ padding: 24, paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 32px)" }}>
          {/* Headline cups count */}
          <div className="flex flex-col items-center" style={{ paddingTop: 24, paddingBottom: 24 }}>
            <span
              className="uppercase"
              style={{ color: "rgba(251,191,36,0.7)", fontSize: 10, fontWeight: 700, letterSpacing: 2.5 }}
            >
              You drank
            </span>
            <span
              className="font-peachi font-bold"
              style={{ color: "#FBBF24", fontSize: 120, letterSpacing: -6, lineHeight: "120px", marginTop: 4 }}
            >
              {total}
            </span>
            <span className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 28, marginTop: -8 }}>
              cup{total === 1 ? "" : "s"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 8, textAlign: "center" }}>
              in {year} · that&apos;s {(total / 52).toFixed(1)} every week
            </span>
          </div>

          {/* Stat cards */}
          <div className="flex flex-col" style={{ gap: 10 }}>
            {data.favorites.product_name ? (
              <BigCard
                eyebrow="Favourite drink"
                value={data.favorites.product_name}
                detail={`${data.favorites.product_count} order${data.favorites.product_count === 1 ? "" : "s"}`}
                Icon={Coffee}
              />
            ) : null}
            {data.favorites.hour !== null ? (
              <BigCard
                eyebrow="Favourite hour"
                value={formatHour(data.favorites.hour)}
                detail={data.favorites.month ? `usually ${MONTH[data.favorites.month - 1]}` : undefined}
                Icon={Clock}
              />
            ) : null}
            <BigCard
              eyebrow="Outlets visited"
              value={String(data.summary.distinct_outlets)}
              detail={`${data.summary.distinct_products} different drinks tried`}
              Icon={MapPin}
            />
            {data.summary.longest_streak_weeks > 0 ? (
              <BigCard
                eyebrow="Longest streak"
                value={`${data.summary.longest_streak_weeks} wks`}
                detail="Weekly visit chain 🔥"
                Icon={Sparkles}
              />
            ) : null}

            {/* The damage */}
            <div
              style={{ backgroundColor: "rgba(251,191,36,0.08)", borderRadius: 18, padding: 18, marginTop: 4 }}
            >
              <p
                className="uppercase"
                style={{ color: "rgba(251,191,36,0.75)", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}
              >
                The damage
              </p>
              <div className="flex" style={{ gap: 18 }}>
                <div className="flex-1">
                  <p className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 24 }}>
                    {formatRM(data.summary.total_spent_sen)}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>Total spent</p>
                </div>
                <div className="flex-1">
                  <p className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 24 }}>
                    {formatRM(data.summary.total_saved_sen)}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>Saved with rewards</p>
                </div>
              </div>
            </div>
          </div>

          {/* Share */}
          <button
            type="button"
            onClick={share}
            className="w-full flex items-center justify-center active:opacity-80"
            style={{ marginTop: 28, backgroundColor: "#FBBF24", borderRadius: 100, paddingTop: 16, paddingBottom: 16, gap: 8 }}
          >
            <Share2 size={16} color="#1A0200" strokeWidth={2.4} />
            <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 15 }}>
              Share my Wrapped
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function BigCard({
  eyebrow,
  value,
  detail,
  Icon,
}: {
  eyebrow: string;
  value: string;
  detail?: string;
  Icon: typeof Coffee;
}) {
  return (
    <div
      className="flex items-center"
      style={{ backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 18, padding: 18, gap: 14 }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(251,191,36,0.18)" }}
      >
        <Icon size={22} color="#FBBF24" strokeWidth={1.8} />
      </span>
      <div className="flex-1 min-w-0">
        <p
          className="uppercase"
          style={{ color: "rgba(251,191,36,0.65)", fontSize: 9, fontWeight: 700, letterSpacing: 1.8, marginBottom: 3 }}
        >
          {eyebrow}
        </p>
        <p className="font-peachi font-bold truncate" style={{ color: "#FFFFFF", fontSize: 20, letterSpacing: -0.3 }}>
          {value}
        </p>
        {detail ? (
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 2 }}>{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
