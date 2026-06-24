"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, MapPin, Play, ArrowLeft, TrendingUp } from "lucide-react";

type GridPoint = { row: number; col: number; lat: number; lng: number; rank: number | null };
type Scan = {
  id: string;
  keyword: string;
  gridSize: number;
  rangeMiles: number;
  centerLat: number;
  centerLng: number;
  status: string;
  points: GridPoint[];
  avgRank: number | null;
  pctTop3: number | null;
  foundPoints: number;
  totalPoints: number;
  greenRadiusM: number | null;
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

function miles(m: number | null): string {
  if (m == null) return "–";
  return (m / 1609.34).toFixed(2) + " mi";
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

export default function GeogridPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState(9);
  const [rangeMiles, setRangeMiles] = useState(0.1);
  const [scans, setScans] = useState<Scan[]>([]);
  const [active, setActive] = useState<Scan | null>(null);
  const [running, setRunning] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(true);
  const [error, setError] = useState("");

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

  const run = async () => {
    setError("");
    if (!keyword.trim()) {
      setError("Enter a keyword");
      return;
    }
    setRunning(true);
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
          <label className="block text-xs font-medium text-muted-foreground">Range (mi)</label>
          <input type="number" step="0.05" min="0.05" value={rangeMiles} onChange={(e) => setRangeMiles(Number(e.target.value))} className="mt-1 w-24 rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        </div>
        <button onClick={run} disabled={running || !outletId} className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Scanning…" : "Run scan"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {active ? (
        <>
          {/* Metrics — the two goals */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Avg rank" value={active.avgRank != null ? active.avgRank.toFixed(1) : "–"} sub="lower is better" />
            <Stat label="% in top 3" value={`${Math.round(active.pctTop3 ?? 0)}%`} sub="more green = better" />
            <Stat label="Green radius" value={miles(active.greenRadiusM)} sub="rank ≤3 reach (goal #2)" />
            <Stat label="Coverage" value={`${active.foundPoints}/${active.totalPoints}`} sub="points ranking ≤20" />
          </div>

          {/* The grid */}
          <div className="mt-5 rounded-xl border border-border bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span className="font-medium text-foreground">&ldquo;{active.keyword}&rdquo;</span> · {active.gridSize}×{active.gridSize} · {active.rangeMiles} mi spacing
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${active.gridSize}, minmax(0, 1fr))`, maxWidth: 520 }}>
              {grid.flat().map((p) => {
                const c = rankColor(p.rank);
                return (
                  <div key={`${p.row}-${p.col}`} className="flex aspect-square items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: c.bg, color: c.fg }} title={`rank ${p.rank ?? ">20"}`}>
                    {c.label}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Center = your storefront. Rank approximated from the Places API (proxy for the Maps local pack) — use it for trend, not exact position.
            </p>
          </div>

          {/* History / trend — the loop */}
          {scans.length > 1 && (
            <div className="mt-5 rounded-xl border border-border bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <TrendingUp className="h-4 w-4" /> Trend (are the two goals moving?)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1">Date</th><th>Keyword</th><th>Avg rank</th><th>% top 3</th><th>Green radius</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.id} className={`border-t border-border ${active.id === s.id ? "bg-muted/40" : ""}`}>
                      <td className="py-1.5">
                        <button onClick={() => setActive(s)} className="text-foreground hover:underline">{new Date(s.createdAt).toLocaleDateString()}</button>
                      </td>
                      <td className="text-muted-foreground">{s.keyword}</td>
                      <td>{s.avgRank != null ? s.avgRank.toFixed(1) : "–"}</td>
                      <td>{Math.round(s.pctTop3 ?? 0)}%</td>
                      <td>{miles(s.greenRadiusM)}</td>
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
