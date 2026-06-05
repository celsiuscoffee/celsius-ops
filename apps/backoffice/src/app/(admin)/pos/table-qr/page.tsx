"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from "react";
import QRCode from "qrcode";
import { Printer, Download, Sparkles, LayoutGrid, ArrowRight, Users, Sandwich, IdCard } from "lucide-react";
import Link from "next/link";
import { adminFetch } from "@/lib/pickup/admin-fetch";

/**
 * Per-table QR generator. Each QR links the customer's phone to the dine-in
 * order page for that outlet + table. Customer scans → menu → order + pay.
 *
 * Two views over the SAME table list (pulled from the floor plan via
 * /api/pos/table-qr, so a table created in the Table Layout editor auto-appears):
 *   • Designed cards — the brand "Scan & Order" table card (espresso bg, °C mark,
 *     Space Grotesk, per-table QR, dynamic "TABLE FOR N" + a configurable footer
 *     note). Print all → the browser's "Save as PDF" gives one tent card per page.
 *     This mirrors the PIL template in /Desktop/Celsius/Table Cards so HQ and the
 *     in-app generator never drift.
 *   • Plain grid — the original bare-QR sheet for quick reference.
 */

// Canonical loyalty outlet ids (match pos_branch_settings.outlet_id). `line` is
// the vertical outlet label printed down the side of the designed card.
const OUTLETS = [
  { id: "outlet-sa", name: "Celsius Shah Alam", line: "SHAH ALAM" },
  { id: "outlet-con", name: "Celsius Putrajaya", line: "CONEZION, PUTRAJAYA" },
  { id: "outlet-tam", name: "Celsius Tamarind", line: "TAMARIND, CYBERJAYA" },
  { id: "outlet-nilai", name: "Celsius Nilai", line: "NILAI" },
] as const;

const BASE_URL = "https://order.celsiuscoffee.com";
const buildTableUrl = (storeId: string, label: string) =>
  `${BASE_URL}/table/${storeId}/${encodeURIComponent(label)}`;

// ── Brand template (mirrors /Desktop/Celsius/Table Cards/_template_generate.py) ──
const BG = "#15090A", CREAM = "#F5F1EA", MUTE = "#96867E", GOLD = "#D2965C", INK = "#160800";
// The card is authored in the 1080×2160 PIL coordinate space; `U()` converts a
// pixel value to container-query width units so the whole card scales with one
// `--card-w` (300px on screen, 11cm in print) and stays pixel-faithful.
const U = (px: number) => `${(px / 10.8).toFixed(3)}cqw`;
const NOTE =
  "A NOTE FROM OUR TABLE TO YOURS — THIS SPACE IS MADE TO BE SHARED. SOLO? GRAB ONE " +
  "OF THE SMALLER TABLES. STAYING A WHILE? KEEP IT WARM WITH A DRINK (OR DRINKSSS) AND " +
  "A BITE — OURS IS MADE TO BE CRAVED & DROOLED OVER. GLAD YOU'RE HERE.";

type LayoutTable = { label: string; floor: string; seats: number | null };
type View = "designed" | "plain";

const tableTitle = (label: string) =>
  /^\d+$/.test(label) ? `TABLE ${label.padStart(2, "0")}` : `TABLE ${label}`;

function Badge({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div
      style={{
        flex: 1, height: U(104), border: "2px solid rgba(245,241,234,0.37)", borderRadius: U(16),
        display: "flex", alignItems: "center", paddingLeft: U(22), paddingRight: U(14), gap: U(20),
        color: CREAM, minWidth: 0,
      }}
    >
      <span style={{ display: "flex", flexShrink: 0, color: CREAM }}>{icon}</span>
      <span style={{ width: U(2), height: U(56), background: "rgba(245,241,234,0.22)", flexShrink: 0 }} />
      <span style={{ fontSize: U(26), fontWeight: 600, lineHeight: 1.05, letterSpacing: U(1) }}>{text}</span>
    </div>
  );
}

/** The brand "Scan & Order" table card — faithful HTML/CSS port of the PIL template. */
function DesignedCard({
  qr, label, seats, outletLine, foot,
}: { qr: string; label: string; seats: number | null; outletLine: string; foot: string }) {
  const title = tableTitle(label);
  const seatText = seats ? `TABLE FOR ${seats}` : "FIND A SEAT";
  return (
    <div
      className="tcard"
      style={{
        width: "var(--card-w)", height: "calc(var(--card-w) * 2)", containerType: "size",
        position: "relative", background: BG, color: CREAM, overflow: "hidden", borderRadius: 16,
        fontFamily: "var(--font-space-grotesk), system-ui, sans-serif", flexShrink: 0,
      }}
    >
      {/* °C mark */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/celsius-degc.png" alt="" style={{ position: "absolute", top: U(104), right: U(92), height: U(116), width: "auto" }} />
      {/* gold accent + eyebrow */}
      <div style={{ position: "absolute", left: U(92), top: U(250), width: U(130), height: U(7), background: GOLD }} />
      <div style={{ position: "absolute", left: U(92), top: U(286), fontSize: U(44), fontWeight: 700, letterSpacing: U(5) }}>
        SCAN &amp; ORDER
      </div>
      {/* headline */}
      <div style={{ position: "absolute", left: U(92), top: U(420), fontSize: U(86), fontWeight: 500, lineHeight: 1.302, whiteSpace: "pre-line" }}>
        {"SCAN QR\nCHOOSE ITEMS\nPAY ONLINE"}
      </div>
      {/* QR panel */}
      <div style={{ position: "absolute", left: U(92), top: U(786), width: U(624), height: U(792), background: "#fff", borderRadius: U(26) }}>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR ${title}`} style={{ position: "absolute", top: U(78), left: U((624 - 470) / 2), width: U(470), height: U(470) }} />
        )}
        <div style={{ position: "absolute", left: U(52), top: U(792 - 130), fontSize: U(58), fontWeight: 500, color: INK }}>{title}</div>
      </div>
      {/* vertical outlet line */}
      <div style={{ position: "absolute", right: U(48), top: U(786 + 792 / 2), transform: "translateY(-50%) rotate(180deg)", writingMode: "vertical-rl", fontSize: U(30), fontWeight: 600, letterSpacing: U(3), whiteSpace: "nowrap" }}>
        {outletLine}
      </div>
      {/* note */}
      <div style={{ position: "absolute", left: U(92), top: U(1694), width: U(896) }}>
        <div style={{ fontSize: U(25), fontWeight: 700, letterSpacing: U(4), color: GOLD, marginBottom: U(18) }}>ACHTUNG!</div>
        <div style={{ fontSize: U(25), fontWeight: 450, lineHeight: 1.6, color: MUTE }}>{NOTE}</div>
      </div>
      {/* badges */}
      <div style={{ position: "absolute", left: U(92), top: U(1964), width: U(896), display: "flex", gap: U(26) }}>
        <Badge icon={<Users color={CREAM} strokeWidth={2} style={{ width: U(52), height: U(52) }} />} text={seatText} />
        <Badge icon={<Sandwich color={CREAM} strokeWidth={2} style={{ width: U(52), height: U(52) }} />} text={foot} />
      </div>
    </div>
  );
}

export default function POSTableQRPage() {
  const [selectedOutlet, setSelectedOutlet] = useState<string>(OUTLETS[0].id);
  const [storeId, setStoreId] = useState<string>("");
  const [layoutTables, setLayoutTables] = useState<LayoutTable[]>([]);
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [manualCount, setManualCount] = useState(10);
  const [generated, setGenerated] = useState(false);
  const [view, setView] = useState<View>("designed");
  const [foot, setFoot] = useState("NO OUTSIDE FOOD");
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const outlet = OUTLETS.find((o) => o.id === selectedOutlet) ?? OUTLETS[0];
  const outletName = outlet.name;
  const fromLayout = layoutTables.length > 0;
  const tables: string[] = fromLayout
    ? layoutTables.map((t) => t.label)
    : Array.from({ length: manualCount }, (_, i) => `T${i + 1}`);
  const seatsOf = (label: string) => layoutTables.find((t) => t.label === label)?.seats ?? null;
  const floorOf = (label: string) => layoutTables.find((t) => t.label === label)?.floor ?? "";
  const tablesKey = tables.join("|");

  // Pull this outlet's floor plan whenever the outlet changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingLayout(true);
    setGenerated(false);
    (async () => {
      try {
        const res = await adminFetch(`/api/pos/table-qr?outlet=${selectedOutlet}`);
        const json = (await res.json()) as { storeId?: string; tables?: LayoutTable[] };
        if (cancelled) return;
        setStoreId(json.storeId || selectedOutlet);
        const t = Array.isArray(json.tables) ? json.tables : [];
        setLayoutTables(t);
        if (t.length > 0) setGenerated(true);
      } catch {
        if (!cancelled) { setStoreId(selectedOutlet); setLayoutTables([]); }
      } finally {
        if (!cancelled) setLoadingLayout(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedOutlet]);

  const generate = useCallback(() => setGenerated(true), []);
  const show = generated || fromLayout;

  // Designed cards: pre-render each QR as a crisp data URL (used by <img>).
  useEffect(() => {
    if (view !== "designed" || !show) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        tables.map(async (label) => {
          const dataUrl = await QRCode.toDataURL(buildTableUrl(storeId, label), {
            width: 600, margin: 1, color: { dark: INK, light: "#ffffff" },
          });
          return [label, dataUrl] as const;
        }),
      );
      if (alive) setQrMap(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [view, show, storeId, tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plain grid: paint the QR canvases once on screen.
  useEffect(() => {
    if (view !== "plain" || !show) return;
    tables.forEach((label) => {
      const canvas = canvasRefs.current.get(label);
      if (!canvas) return;
      QRCode.toCanvas(canvas, buildTableUrl(storeId, label), {
        width: 200, margin: 2, color: { dark: "#160800", light: "#ffffff" },
      });
    });
  }, [view, show, storeId, tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = () => window.print();
  const downloadSingle = async (label: string) => {
    const dataUrl = await QRCode.toDataURL(buildTableUrl(storeId, label), {
      width: 400, margin: 2, color: { dark: "#160800", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${storeId}-${label}.png`;
    a.click();
  };

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl">
      {/* Print rules: one designed tent card per page; plain grid keeps its sheet. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 portrait; margin: 1cm; }
  body { background: #fff !important; }
  .tqr-designed .tcard-page { display: flex !important; align-items: center; justify-content: center;
    page-break-after: always; break-after: page; height: auto; }
  .tqr-designed .tcard-page:last-child { page-break-after: auto; break-after: auto; }
  .tqr-designed .tcard { --card-w: 11cm !important; border-radius: 0 !important; box-shadow: none !important; }
}`,
        }}
      />

      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-[#160800]">Table QR Codes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Auto-generated from each outlet&rsquo;s floor plan. Customer scans → menu → order + pay on their phone.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Outlet</label>
          <select
            value={selectedOutlet}
            onChange={(e) => setSelectedOutlet(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
          >
            {OUTLETS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {/* View toggle */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Style</label>
          <div className="inline-flex rounded-xl border border-gray-200 p-0.5">
            <button
              onClick={() => setView("designed")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "designed" ? "bg-[#160800] text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <IdCard className="h-4 w-4" /> Designed cards
            </button>
            <button
              onClick={() => setView("plain")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "plain" ? "bg-[#160800] text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <LayoutGrid className="h-4 w-4" /> Plain grid
            </button>
          </div>
        </div>

        {/* Footer note (designed only) */}
        {view === "designed" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Footer note</label>
            <input
              value={foot}
              onChange={(e) => setFoot(e.target.value.toUpperCase().slice(0, 22))}
              className="w-48 rounded-xl border border-gray-200 px-3 py-2 text-sm uppercase focus:border-[#160800] focus:outline-none"
            />
          </div>
        )}

        {/* Source: floor plan (auto) vs. manual fallback */}
        {loadingLayout ? (
          <div className="text-sm text-gray-400">Loading floor plan…</div>
        ) : fromLayout ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#A2492C]/20 bg-[#FBEBE8]/60 px-3 py-2">
            <LayoutGrid className="h-4 w-4 text-[#A2492C]" />
            <span className="text-sm font-medium text-[#160800]">
              {layoutTables.length} table{layoutTables.length === 1 ? "" : "s"} from your floor plan
            </span>
            <Link href="/pos/settings" className="flex items-center gap-0.5 text-xs font-semibold text-[#A2492C] hover:underline">
              Edit layout <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Number of tables</label>
              <input
                type="number"
                min={1}
                max={50}
                value={manualCount}
                onChange={(e) => { setManualCount(Math.max(1, Math.min(50, Number(e.target.value)))); setGenerated(false); }}
                className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
              />
            </div>
            <button
              onClick={generate}
              className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
            >
              <Sparkles className="h-4 w-4" /> Generate
            </button>
          </>
        )}

        {show && (
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 border border-gray-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Printer className="h-4 w-4" /> Print all
          </button>
        )}
      </div>

      {view === "designed" && show && (
        <p className="text-xs text-gray-500 print:hidden">
          Print all → in the print dialog choose <span className="font-semibold">Save as PDF</span> for a print-ready file
          (one tent card per page). Cards size to the table&rsquo;s seat count automatically.
        </p>
      )}

      {!loadingLayout && !fromLayout && (
        <p className="text-xs text-gray-500 print:hidden">
          No floor plan set for this outlet yet — using a manual count.{" "}
          <Link href="/pos/settings" className="font-semibold text-[#A2492C] hover:underline">Set up tables in POS Settings → Table Layout</Link>{" "}
          (set seats per table for the &ldquo;TABLE FOR N&rdquo; badge) and they&rsquo;ll appear here automatically.
        </p>
      )}

      {/* Designed cards */}
      {view === "designed" && show && (
        <div className="tqr-designed flex flex-wrap gap-6" style={{ "--card-w": "300px" } as CSSProperties}>
          {tables.map((label) => (
            <div key={label} className="tcard-page">
              <DesignedCard
                qr={qrMap[label] ?? ""}
                label={label}
                seats={seatsOf(label)}
                outletLine={outlet.line}
                foot={foot}
              />
            </div>
          ))}
        </div>
      )}

      {/* Plain grid */}
      {view === "plain" && show && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 print:grid-cols-3 print:gap-4">
          {tables.map((label) => {
            const url = buildTableUrl(storeId, label);
            const floor = floorOf(label);
            return (
              <div
                key={label}
                className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-4 print:break-inside-avoid print:border print:shadow-none"
              >
                <canvas
                  ref={(el) => { if (el) canvasRefs.current.set(label, el); }}
                  className="h-[200px] w-[200px]"
                />
                <p className="mt-3 text-xl font-bold text-[#160800]">{label}</p>
                <p className="text-xs text-gray-500 text-center">
                  {outletName}{floor ? ` · ${floor}` : ""}
                </p>
                <p className="mt-1 max-w-[180px] truncate text-[10px] text-gray-400">{url}</p>
                <button
                  onClick={() => downloadSingle(label)}
                  className="mt-2 flex items-center gap-1 text-xs text-[#A2492C] hover:underline print:hidden"
                >
                  <Download className="h-3 w-3" /> PNG
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
