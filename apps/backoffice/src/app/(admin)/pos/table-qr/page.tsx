"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from "react";
import QRCode from "qrcode";
import { Printer, Download, Sparkles, LayoutGrid, ArrowRight, Users, Sandwich, IdCard, FileDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { renderStickerBlob, prepareStickerAssets, makeZip, downloadBlob } from "./table-sticker-export";

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
  qr, label, seats, outletLine, foot, radius = 16,
}: { qr: string; label: string; seats: number | null; outletLine: string; foot: string; radius?: number }) {
  const title = tableTitle(label);
  const seatText = seats ? `TABLE FOR ${seats}` : "FIND A SEAT";
  return (
    <div
      className="tcard"
      style={{
        width: "var(--card-w)", height: "calc(var(--card-w) * 2)", containerType: "size",
        position: "relative", background: BG, color: CREAM, overflow: "hidden", borderRadius: radius,
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

// ── Print-production geometry (mm/cm), matches print_stickers.py ──
const BLEED_CM = 0.3;   // 3 mm background bleed past the trim
const SLUG_CM = 0.8;    // white margin holding the crop marks
const MARK_CM = 0.5;    // crop-mark length
const CAP_CM = 1.2;     // extra bottom room for the spec caption
const ORIGIN = SLUG_CM + BLEED_CM; // trim origin from page edge
const DIE_RADIUS = "8mm";
const cm = (n: number) => `${+n.toFixed(3)}cm`;
const stickerPage = (trimW: number) => ({
  pageW: trimW + 2 * ORIGIN,
  pageH: trimW * 2 + 2 * ORIGIN + CAP_CM,
});

/** One print-ready sticker: full-bleed art + crop marks + magenta die-cut line + spec. */
function StickerPage({
  qr, label, seats, outletLine, foot, trimW,
}: { qr: string; label: string; seats: number | null; outletLine: string; foot: string; trimW: number }) {
  const trimH = trimW * 2;
  const o = ORIGIN;
  const { pageW, pageH } = stickerPage(trimW);
  const mark = { position: "absolute" as const, background: "#000" };
  const h = (x: number, y: number) => ({ ...mark, left: cm(x), top: cm(y), width: cm(MARK_CM), height: "0.3mm" });
  const v = (x: number, y: number) => ({ ...mark, left: cm(x), top: cm(y), width: "0.3mm", height: cm(MARK_CM) });
  return (
    <div className="sticker" style={{ position: "relative", width: cm(pageW), height: cm(pageH), background: "#fff" }}>
      {/* espresso bleed */}
      <div style={{ position: "absolute", left: cm(SLUG_CM), top: cm(SLUG_CM), width: cm(trimW + 2 * BLEED_CM), height: cm(trimH + 2 * BLEED_CM), background: BG }} />
      {/* card art at trim */}
      <div style={{ position: "absolute", left: cm(o), top: cm(o), ["--card-w" as string]: cm(trimW) } as CSSProperties}>
        <DesignedCard qr={qr} label={label} seats={seats} outletLine={outletLine} foot={foot} radius={0} />
      </div>
      {/* die-cut path (magenta, rounded) */}
      <div style={{ position: "absolute", left: cm(o), top: cm(o), width: cm(trimW), height: cm(trimH), border: "0.3mm solid #ff00ff", borderRadius: DIE_RADIUS, boxSizing: "border-box", pointerEvents: "none" }} />
      {/* crop marks (start at bleed edge, extend into the slug) */}
      <div style={h(o - BLEED_CM - MARK_CM, o)} /><div style={v(o, o - BLEED_CM - MARK_CM)} />
      <div style={h(o + trimW + BLEED_CM, o)} /><div style={v(o + trimW, o - BLEED_CM - MARK_CM)} />
      <div style={h(o - BLEED_CM - MARK_CM, o + trimH)} /><div style={v(o, o + trimH + BLEED_CM)} />
      <div style={h(o + trimW + BLEED_CM, o + trimH)} /><div style={v(o + trimW, o + trimH + BLEED_CM)} />
      {/* spec caption */}
      <div style={{ position: "absolute", left: 0, top: cm(o + trimH + 0.4), width: "100%", textAlign: "center", fontFamily: "var(--font-space-grotesk)", lineHeight: 1.5 }}>
        <div style={{ fontSize: "7pt", fontWeight: 600, color: "#555" }}>CELSIUS — SCAN &amp; ORDER TABLE STICKER · {outletLine} · {tableTitle(label)}</div>
        <div style={{ fontSize: "6.5pt", color: "#888" }}>Finished {trimW} × {trimH} cm · Bleed 3 mm · Die-cut rounded corners R8 mm · 300 DPI</div>
        <div style={{ fontSize: "6.5pt", color: "#c07ab0" }}>Magenta line = die-cut path (non-printing). Background is full-bleed — trim on crop marks.</div>
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
  const [stickerW, setStickerW] = useState(10); // finished width in cm; height auto = 2×
  const [zipBusy, setZipBusy] = useState<{ done: number; total: number } | null>(null);
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

  // Render every sticker to a 300 DPI PNG and bundle into one ZIP for the printer.
  const exportZip = async () => {
    if (zipBusy) return;
    setZipBusy({ done: 0, total: tables.length });
    try {
      const { degc, fam } = await prepareStickerAssets();
      const files: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < tables.length; i++) {
        const label = tables[i];
        const blob = await renderStickerBlob(
          { url: buildTableUrl(storeId, label), label, seats: seatsOf(label), outletLine: outlet.line, foot, stickerWcm: stickerW },
          degc, fam,
        );
        const nn = /^\d+$/.test(label) ? label.padStart(2, "0") : label;
        files.push({ name: `Table_${nn}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        setZipBusy({ done: i + 1, total: tables.length });
      }
      const safe = outletName.replace(/[^\w]+/g, "-");
      downloadBlob(makeZip(files), `Celsius-Stickers-${safe}-${stickerW}x${stickerW * 2}cm.zip`);
    } catch (e) {
      console.error("Sticker ZIP export failed", e);
      alert("Sorry — the PNG export hit an error. Please try again.");
    } finally {
      setZipBusy(null);
    }
  };
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
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl print:p-0 print:m-0 print:space-y-0 print:max-w-none">
      {/* Print rules. Designed view → one print-ready sticker per page (page sized
          to the chosen sticker + bleed + crop-mark slug). Plain view → A4 sheet. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            view === "designed"
              ? `
@media print {
  @page { size: ${stickerPage(stickerW).pageW.toFixed(2)}cm ${stickerPage(stickerW).pageH.toFixed(2)}cm; margin: 0; }
  body { background: #fff !important; }
  /* Force the espresso fill + cream text to print even when the dialog's
     "Background graphics" is OFF (its default). Without this the card prints blank. */
  .sticker, .sticker * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .sticker { page-break-after: always; break-after: page; box-shadow: none !important; }
  .sticker:last-child { page-break-after: auto; break-after: auto; }
}`
              : `
@media print {
  @page { size: A4 portrait; margin: 1cm; }
  body { background: #fff !important; }
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

        {/* Sticker size (designed only) — drives the print-ready output */}
        {view === "designed" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Sticker width (cm)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={20}
                step={0.5}
                value={stickerW}
                onChange={(e) => setStickerW(Math.max(5, Math.min(20, Number(e.target.value) || 10)))}
                className="w-20 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">= {stickerW} × {stickerW * 2} cm finished</span>
            </div>
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

        {show && view === "designed" && (
          <button
            onClick={exportZip}
            disabled={!!zipBusy}
            className="flex items-center gap-2 bg-[#A2492C] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#8a3d24] transition-colors disabled:opacity-60"
          >
            {zipBusy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Exporting {zipBusy.done}/{zipBusy.total}…</>
            ) : (
              <><FileDown className="h-4 w-4" /> Export PNG (ZIP)</>
            )}
          </button>
        )}
      </div>

      {view === "designed" && show && (
        <p className="text-xs text-gray-500 print:hidden">
          <span className="font-semibold">Print all → Save as PDF</span> gives the print-company file: each sticker on its
          own page at <span className="font-semibold">{stickerW} × {stickerW * 2} cm</span> with 3 mm bleed, crop marks, a
          magenta die-cut line (rounded R8 mm) and a spec caption. In the print dialog set Margins = <span className="font-semibold">None</span>,
          Scale = <span className="font-semibold">100%</span>, and <span className="font-semibold">Background graphics = On</span> (under
          “More settings”) so the dark fill prints. Or <span className="font-semibold">Export PNG (ZIP)</span> — all stickers as
          300 DPI PNGs (bleed + crop marks + die-cut) in one zip to send the printer. Capacity badge follows each table&rsquo;s seat count automatically.
        </p>
      )}

      {!loadingLayout && !fromLayout && (
        <p className="text-xs text-gray-500 print:hidden">
          No floor plan set for this outlet yet — using a manual count.{" "}
          <Link href="/pos/settings" className="font-semibold text-[#A2492C] hover:underline">Set up tables in POS Settings → Table Layout</Link>{" "}
          (set seats per table for the &ldquo;TABLE FOR N&rdquo; badge) and they&rsquo;ll appear here automatically.
        </p>
      )}

      {/* Designed cards — on-screen preview (hidden in print; the sticker block prints) */}
      {view === "designed" && show && (
        <div className="tqr-designed flex flex-wrap gap-6 print:hidden" style={{ "--card-w": "300px" } as CSSProperties}>
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

      {/* Print-only: one print-ready sticker per page (bleed + crop marks + die-cut line) */}
      {view === "designed" && show && (
        <div className="hidden print:block">
          {tables.map((label) => (
            <StickerPage
              key={label}
              qr={qrMap[label] ?? ""}
              label={label}
              seats={seatsOf(label)}
              outletLine={outlet.line}
              foot={foot}
              trimW={stickerW}
            />
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
