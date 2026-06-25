"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, MapPin, Play, ArrowLeft, TrendingUp, ChevronDown, Sparkles } from "lucide-react";

type PointResult = { name: string; placeId: string; isUs: boolean };
type GridPoint = { row: number; col: number; lat: number; lng: number; rank: number | null; results?: PointResult[] };
type PlaceProfile = {
  name: string;
  rating: number | null;
  reviews: number | null;
  hasWebsite: boolean;
  hasPhone: boolean;
  hasHours: boolean;
  photos: number;
  hasDescription: boolean;
};
type Suggestion = { tag: string; priority: "high" | "med" | "low"; text: string; levers: string[] };
type Compare = { us: PlaceProfile | null; them: PlaceProfile; suggestions: Suggestion[] };
type Scan = {
  id: string;
  keyword: string;
  gridSize: number;
  rangeMiles: number;
  centerLat: number;
  centerLng: number;
  placeId?: string | null;
  status: string;
  points: GridPoint[];
  avgRank: number | null;
  pctTop3: number | null;
  foundPoints: number;
  totalPoints: number;
  greenRadiusM: number | null;
  competitors: { name: string; top3Points: number; avgRank: number }[];
  createdAt: string;
};
type Outlet = { id: string; name: string };

function rankColor(rank: number | null): { bg: string; fg: string; label: string } {
  if (rank == null) return { bg: "#9ca3af", fg: "#fff", label: "–" };
  const label = String(rank);
  if (rank <= 3) return { bg: "#15803d", fg: "#fff", label };
  if (rank <= 6) return { bg: "#65a30d", fg: "#fff", label };
  if (rank <= 10) return { bg: "#eab308", fg: "#1a1a1a", label };
  if (rank <= 15) return { bg: "#f97316", fg: "#fff", label };
  return { bg: "#dc2626", fg: "#fff", label };
}

function km(m: number | null): string {
  if (m == null) return "–";
  return (m / 1000).toFixed(2) + " km";
}

function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// The KPI: #1 within 1km, Top-2 within 5km, Top-3 within 10km.
const KPIS = [
  { label: "#1 within 1 km", ringKm: 1, target: 1 },
  { label: "Top 2 within 5 km", ringKm: 5, target: 2 },
  { label: "Top 3 within 10 km", ringKm: 10, target: 3 },
];

// % of scanned points within `ringKm` that hit the target rank. Only measurable
// if the scan actually reaches that ring.
function evalKpi(
  scan: Scan,
  ringKm: number,
  target: number,
): { measurable: boolean; pct: number; n: number } {
  const ranked = scan.points.filter((p) => p.rank != null) as (GridPoint & { rank: number })[];
  const dists = ranked.map((p) => ({ p, d: distM(scan.centerLat, scan.centerLng, p.lat, p.lng) }));
  const maxDist = dists.length ? Math.max(...dists.map((x) => x.d)) : 0;
  const covered = maxDist >= ringKm * 1000 * 0.85;
  const inRing = dists.filter((x) => x.d <= ringKm * 1000);
  if (!covered || inRing.length === 0) return { measurable: false, pct: 0, n: 0 };
  const met = inRing.filter((x) => x.p.rank <= target).length;
  return { measurable: true, pct: Math.round((met / inRing.length) * 100), n: inRing.length };
}

// Who out-ranks us in the OUTER ring of the scan (the far points where proximity
// favours rivals). "Far" = points at ≥50% of the scanned reach, so it adapts to
// any scan size. A rival "beats us" at a point when it ranks above our position
// there (or we're absent). Returns the worst offenders + the km threshold used.
function outerRingRivals(
  scan: Scan,
): { thresholdKm: number; farPoints: number; rivals: { name: string; beats: number; bestRank: number }[] } {
  const withData = scan.points.filter((p) => p.results && p.results.length);
  const dists = withData.map((p) => distM(scan.centerLat, scan.centerLng, p.lat, p.lng));
  const maxDist = dists.length ? Math.max(...dists) : 0;
  const threshold = maxDist * 0.5;
  const tally = new Map<string, { name: string; beats: number; bestRank: number }>();
  let farPoints = 0;
  withData.forEach((p, i) => {
    if (dists[i] < threshold) return;
    farPoints++;
    (p.results ?? []).forEach((r, idx) => {
      const theirRank = idx + 1;
      if (r.isUs || !r.name) return;
      const beatsUs = p.rank == null || theirRank < p.rank;
      if (!beatsUs) return;
      const key = r.placeId || r.name.toLowerCase();
      const t = tally.get(key) ?? { name: r.name, beats: 0, bestRank: theirRank };
      t.beats++;
      t.bestRank = Math.min(t.bestRank, theirRank);
      tally.set(key, t);
    });
  });
  const rivals = [...tally.values()].sort((a, b) => b.beats - a.beats || a.bestRank - b.bestRank).slice(0, 5);
  return { thresholdKm: threshold / 1000, farPoints, rivals };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const PRIORITY_DOT: Record<string, string> = { high: "bg-red-500", med: "bg-amber-500", low: "bg-emerald-500" };

// A ranked business in the per-point list, with an on-demand "how to beat them"
// drawer that diffs their Google profile against ours into concrete actions.
function CompetitorRow({ rank, r, ourPlaceId }: { rank: number; r: PointResult; ourPlaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Compare | null>(null);
  const [err, setErr] = useState("");

  const canCompare = !r.isUs && !!r.placeId;

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data || !canCompare) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/geogrid/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitorPlaceId: r.placeId, ourPlaceId }),
      });
      const d = await res.json();
      if (res.ok) setData(d);
      else setErr(d.error || "Lookup failed");
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="rounded-lg">
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${r.isUs ? "bg-brand-dark/10 font-semibold text-foreground" : "text-muted-foreground"}`}
      >
        <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-foreground ring-1 ring-border">
          {rank}
        </span>
        <span className="truncate">{r.name || "Unknown"}</span>
        {r.isUs ? (
          <span className="ml-auto rounded bg-brand-dark px-1.5 py-0.5 text-[10px] font-medium text-white">You</span>
        ) : canCompare ? (
          <button
            onClick={toggle}
            className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted/50"
          >
            <Sparkles className="h-3 w-3" /> How to beat them
            <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </div>

      {open && canCompare && (
        <div className="ml-7 mr-2 mb-1.5 mt-1 rounded-lg border border-border bg-white p-3">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Comparing profiles…
            </p>
          ) : err ? (
            <p className="text-xs text-red-600">{err}</p>
          ) : data ? (
            <>
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">Them:</span> {data.them.reviews ?? "–"} reviews
                  {data.them.rating != null ? ` · ${data.them.rating.toFixed(1)}★` : ""}
                </span>
                <span>
                  <span className="font-medium text-foreground">You:</span>{" "}
                  {data.us ? `${data.us.reviews ?? "–"} reviews${data.us.rating != null ? ` · ${data.us.rating.toFixed(1)}★` : ""}` : "profile not linked"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-foreground">
                    <span className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${PRIORITY_DOT[s.priority] ?? "bg-neutral-400"}`} />
                    <span>
                      <span className="font-medium">{s.tag}:</span> {s.text}
                      {s.levers && s.levers.length > 0 && (
                        <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-2.5 text-[11px] text-muted-foreground">
                          {s.levers.map((l, j) => (
                            <li key={j} className="flex gap-1.5">
                              <span className="select-none">→</span>
                              <span>{l}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function GeogridPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState(9);
  const [radiusKm, setRadiusKm] = useState(2);
  const [scans, setScans] = useState<Scan[]>([]);
  const [filterKeyword, setFilterKeyword] = useState(""); // "" = all keywords
  const [active, setActive] = useState<Scan | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<GridPoint | null>(null);
  const [liveResults, setLiveResults] = useState<Record<string, PointResult[]>>({});
  const [pointLoading, setPointLoading] = useState(false);
  const [pointError, setPointError] = useState("");
  const [running, setRunning] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(true);
  const [error, setError] = useState("");

  // Scans for the chosen keyword (or all), and the distinct keywords for the filter.
  const keywordOptions = [...new Set(scans.map((s) => s.keyword))];
  const visibleScans = filterKeyword ? scans.filter((s) => s.keyword === filterKeyword) : scans;

  useEffect(() => {
    fetch("/api/settings/outlets")
      .then((r) => r.json())
      .then((d) => {
        const list: Outlet[] = (Array.isArray(d) ? d : d.outlets ?? []).map((o: Outlet) => ({ id: o.id, name: o.name }));
        setOutlets(list);
        if (list[0]) setOutletId(list[0].id);
      })
      .catch(() => setOutlets([]));
  }, []);

  const loadHistory = useCallback(async (oid: string) => {
    if (!oid) return;
    const res = await fetch(`/api/geogrid/scan?outletId=${oid}`);
    const d = await res.json();
    setScans(d.scans ?? []);
    setKeyConfigured(d.keyConfigured ?? true);
    setActive((d.scans ?? [])[0] ?? null);
  }, []);

  useEffect(() => {
    loadHistory(outletId);
  }, [outletId, loadHistory]);

  // Clear the per-point detail whenever the displayed scan changes.
  useEffect(() => {
    setSelectedPoint(null);
    setLiveResults({});
    setPointError("");
  }, [active?.id]);

  // When the keyword filter changes, jump to the newest scan that matches it.
  useEffect(() => {
    const list = filterKeyword ? scans.filter((s) => s.keyword === filterKeyword) : scans;
    setActive(list[0] ?? null);
  }, [filterKeyword, scans]);

  // Click a grid point → show who ranks there. Newer scans have the list stored;
  // for older scans (and unranked points) we look it up live from the Places API.
  const selectPoint = async (p: GridPoint) => {
    if (!active) return;
    if (selectedPoint?.row === p.row && selectedPoint?.col === p.col) {
      setSelectedPoint(null);
      return;
    }
    setSelectedPoint(p);
    setPointError("");
    const key = `${p.row}-${p.col}`;
    if ((p.results && p.results.length) || liveResults[key]) return; // already have it
    setPointLoading(true);
    try {
      const res = await fetch("/api/geogrid/point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId,
          keyword: active.keyword,
          lat: p.lat,
          lng: p.lng,
          rangeMiles: active.rangeMiles,
          placeId: active.placeId ?? null,
        }),
      });
      const d = await res.json();
      if (res.ok) setLiveResults((prev) => ({ ...prev, [key]: d.results ?? [] }));
      else setPointError(d.error || "Lookup failed");
    } catch {
      setPointError("Network error");
    } finally {
      setPointLoading(false);
    }
  };

  const run = async () => {
    setError("");
    if (!keyword.trim()) {
      setError("Enter a keyword");
      return;
    }
    setRunning(true);
    // radius (km, store→edge) → spacing (miles) between the gridSize points
    const rangeMiles = radiusKm / ((gridSize - 1) / 2) / 1.60934;
    try {
      const res = await fetch("/api/geogrid/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, keyword: keyword.trim(), gridSize, rangeMiles }),
      });
      const d = await res.json();
      if (res.ok && d.scan) {
        setActive(d.scan);
        await loadHistory(outletId);
      } else {
        setError(d.error || "Scan failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  };

  // order active points into rows
  const grid: GridPoint[][] = [];
  if (active) {
    for (let r = 0; r < active.gridSize; r++) {
      grid.push(active.points.filter((p) => p.row === r).sort((a, b) => a.col - b.col));
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/reviews" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Reviews
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Local Rank Geogrid</h1>
      <p className="text-sm text-muted-foreground">
        Where you rank for a keyword across the map. Two goals: lift the rank (more green) and widen the green radius.
      </p>

      {!keyConfigured && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Scans are inactive until <span className="font-mono">GOOGLE_PLACES_API_KEY</span> is set and the Places API is enabled on project 23036. History below still works.
        </div>
      )}

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Outlet</label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Keyword</label>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. cafe cyberjaya" className="mt-1 w-48 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Grid</label>
          <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            {[5, 7, 9, 11, 13].map((n) => (
              <option key={n} value={n}>{n}×{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Radius (km)</label>
          <input type="number" step="0.5" min="0.5" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="mt-1 w-24 rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        </div>
        <button onClick={run} disabled={running || !outletId} className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Scanning…" : "Run scan"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* Keyword filter — narrow the grid + trend to one tracked keyword */}
      {keywordOptions.length > 1 && (
        <div className="mt-4 flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Show keyword</label>
          <select
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
          >
            <option value="">All keywords ({scans.length})</option>
            {keywordOptions.map((k) => (
              <option key={k} value={k}>
                {k} ({scans.filter((s) => s.keyword === k).length})
              </option>
            ))}
          </select>
        </div>
      )}

      {active ? (
        <>
          {/* KPI vs target — #1@1km · Top-2@5km · Top-3@10km */}
          <div className="mt-6 rounded-xl border border-border bg-white p-4">
            <div className="mb-3 text-sm font-medium text-foreground">KPI vs target</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {KPIS.map((k) => {
                const r = evalKpi(active, k.ringKm, k.target);
                const tone = !r.measurable
                  ? { ring: "border-border", txt: "text-muted-foreground", dot: "bg-neutral-300" }
                  : r.pct >= 90
                    ? { ring: "border-emerald-200 bg-emerald-50", txt: "text-emerald-700", dot: "bg-emerald-500" }
                    : r.pct >= 50
                      ? { ring: "border-amber-200 bg-amber-50", txt: "text-amber-700", dot: "bg-amber-500" }
                      : { ring: "border-red-200 bg-red-50", txt: "text-red-700", dot: "bg-red-500" };
                return (
                  <div key={k.label} className={`rounded-lg border p-3 ${tone.ring}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                      <span className="text-xs font-medium text-foreground">{k.label}</span>
                    </div>
                    {r.measurable ? (
                      <p className={`mt-1 text-xl font-bold ${tone.txt}`}>
                        {r.pct}% <span className="text-[11px] font-normal text-muted-foreground">of {r.n} pts hit it</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">needs a ≥{k.ringKm} km scan</p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              % of scanned points within each ring hitting the target rank. Run a ~10 km scan to grade all three at once.
            </p>
          </div>

          {/* Metrics — the two goals */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Avg rank" value={active.avgRank != null ? active.avgRank.toFixed(1) : "–"} sub="lower is better" />
            <Stat label="% in top 3" value={`${Math.round(active.pctTop3 ?? 0)}%`} sub="more green = better" />
            <Stat label="Green radius" value={km(active.greenRadiusM)} sub="rank ≤3 reach (goal #2)" />
            <Stat label="Coverage" value={`${active.foundPoints}/${active.totalPoints}`} sub="points ranking ≤20" />
          </div>

          {/* The grid */}
          <div className="mt-5 rounded-xl border border-border bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="font-medium text-foreground">&ldquo;{active.keyword}&rdquo;</span> · {active.gridSize}×{active.gridSize} · ~{(active.rangeMiles * ((active.gridSize - 1) / 2) * 1.60934).toFixed(1)} km radius
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${active.gridSize}, minmax(0, 1fr))`, maxWidth: 520 }}>
              {grid.flat().map((p) => {
                const c = rankColor(p.rank);
                const isSelected = selectedPoint?.row === p.row && selectedPoint?.col === p.col;
                return (
                  <button
                    key={`${p.row}-${p.col}`}
                    type="button"
                    onClick={() => selectPoint(p)}
                    className={`flex aspect-square cursor-pointer items-center justify-center rounded-full text-xs font-bold transition hover:opacity-90 ${isSelected ? "ring-2 ring-brand-dark ring-offset-2" : ""}`}
                    style={{ backgroundColor: c.bg, color: c.fg }}
                    title={`rank ${p.rank ?? ">20"} — click for competitors here`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Center = your storefront. Rank approximated from the Places API (proxy for the Maps local pack) — use it for trend, not exact position. Click any point to see who ranks there.
            </p>

            {/* Per-point detail — who ranks at the clicked grid cell */}
            {selectedPoint && (
              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium text-foreground">
                    Ranking at this point
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ~{(distM(active.centerLat, active.centerLng, selectedPoint.lat, selectedPoint.lng) / 1000).toFixed(2)} km from storefront
                      {selectedPoint.rank != null ? ` · you rank #${selectedPoint.rank}` : " · you’re not in the top 20"}
                    </span>
                  </div>
                  <button onClick={() => setSelectedPoint(null)} className="text-xs text-muted-foreground hover:text-foreground">
                    Close
                  </button>
                </div>
                {(() => {
                  const stored = selectedPoint.results;
                  const live = liveResults[`${selectedPoint.row}-${selectedPoint.col}`];
                  const rows = stored && stored.length ? stored : live;
                  if (pointLoading && !rows) {
                    return (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up who ranks here…
                      </p>
                    );
                  }
                  if (pointError) {
                    return <p className="text-xs text-red-600">{pointError}</p>;
                  }
                  if (rows && rows.length > 0) {
                    return (
                      <ol className="space-y-0.5">
                        {rows.map((r, i) => (
                          <CompetitorRow key={r.placeId || `${r.name}-${i}`} rank={i + 1} r={r} ourPlaceId={active.placeId ?? null} />
                        ))}
                      </ol>
                    );
                  }
                  return <p className="text-xs text-muted-foreground">No businesses ranked here for this keyword.</p>;
                })()}
              </div>
            )}
          </div>

          {/* Outer-ring callout — who beats us at distance, where proximity favours rivals */}
          {(() => {
            const ring = outerRingRivals(active);
            if (ring.farPoints === 0 || ring.rivals.length === 0) return null;
            return (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-sm font-medium text-amber-900">
                  Who out-ranks you at distance (≥{ring.thresholdKm.toFixed(1)} km)
                </div>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  Across the {ring.farPoints} outer-ring point{ring.farPoints === 1 ? "" : "s"}, these rivals rank above you most often. Out here Google leans on proximity — you climb past them with prominence (more reviews, faster).
                </p>
                <ul className="mt-2 space-y-1">
                  {ring.rivals.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-amber-900">
                      <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-amber-900 ring-1 ring-amber-200">
                        {i + 1}
                      </span>
                      <span className="truncate">{r.name}</span>
                      <span className="ml-auto whitespace-nowrap text-xs text-amber-800">
                        beats you at {r.beats} pt{r.beats === 1 ? "" : "s"} · best #{r.bestRank}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Competitors — who out-ranks us, for reference */}
          {active.competitors && active.competitors.length > 0 && (
            <div className="mt-5 rounded-xl border border-border bg-white p-4">
              <div className="mb-2 text-sm font-medium text-foreground">Top competitors here (for reference)</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1">Competitor</th><th>In top-3 at</th><th>Avg rank</th>
                  </tr>
                </thead>
                <tbody>
                  {active.competitors.map((c, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5">{c.name}</td>
                      <td>{c.top3Points} / {active.totalPoints} pts</td>
                      <td>{c.avgRank.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Who shows above you across the grid. You climb past them with prominence — more reviews, faster.
              </p>
            </div>
          )}

          {/* History / trend — the loop */}
          {visibleScans.length > 1 && (
            <div className="mt-5 rounded-xl border border-border bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <TrendingUp className="h-4 w-4" /> Trend{filterKeyword ? ` · "${filterKeyword}"` : ""} (are the two goals moving?)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1">Date</th><th>Keyword</th><th>Avg rank</th><th>% top 3</th><th>Green radius</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleScans.map((s) => (
                    <tr key={s.id} className={`border-t border-border ${active.id === s.id ? "bg-muted/40" : ""}`}>
                      <td className="py-1.5">
                        <button onClick={() => setActive(s)} className="text-foreground hover:underline">{new Date(s.createdAt).toLocaleDateString()}</button>
                      </td>
                      <td className="text-muted-foreground">{s.keyword}</td>
                      <td>{s.avgRank != null ? s.avgRank.toFixed(1) : "–"}</td>
                      <td>{Math.round(s.pctTop3 ?? 0)}%</td>
                      <td>{km(s.greenRadiusM)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-border bg-white p-10 text-center">
          <MapPin className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No scans yet for this outlet. Enter a keyword and run one.</p>
        </div>
      )}
    </div>
  );
}
