"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import QRCode from "qrcode";
import { Printer, Download, Sparkles } from "lucide-react";

/**
 * Per-table QR generator. Each QR links the customer's phone to the
 * dine-in order page for that outlet + table. Customer scans → menu →
 * order + pay on their own phone. Print-friendly layout for bulk
 * laminating.
 *
 * Ported from POS-local /backoffice/table-qr as part of the BO-canonical
 * migration. Outlet IDs match the legacy string IDs (shah-alam, conezion,
 * tamarind) used by order.celsiuscoffee.com routing.
 */

const OUTLETS = [
  { id: "shah-alam", name: "Celsius Shah Alam" },
  { id: "conezion",  name: "Celsius Conezion (Putrajaya)" },
  { id: "tamarind",  name: "Celsius Tamarind Square" },
  { id: "nilai",     name: "Celsius Nilai" },
] as const;

const BASE_URL = "https://order.celsiuscoffee.com";

function buildTableUrl(outletId: string, tableId: string) {
  return `${BASE_URL}/table/${outletId}/${tableId}`;
}

export default function POSTableQRPage() {
  const [selectedOutlet, setSelectedOutlet] = useState<string>(OUTLETS[0].id);
  const [tableCount, setTableCount] = useState(10);
  const [generated, setGenerated] = useState(false);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const tables = Array.from({ length: tableCount }, (_, i) => `T${i + 1}`);
  const outletName = OUTLETS.find((o) => o.id === selectedOutlet)?.name ?? "";

  const generate = useCallback(() => {
    setGenerated(true);
  }, []);

  useEffect(() => {
    if (!generated) return;
    tables.forEach((tableId) => {
      const canvas = canvasRefs.current.get(tableId);
      if (!canvas) return;
      const url = buildTableUrl(selectedOutlet, tableId);
      QRCode.toCanvas(canvas, url, {
        width: 200,
        margin: 2,
        color: { dark: "#160800", light: "#ffffff" },
      });
    });
  }, [generated, selectedOutlet, tableCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = () => window.print();

  const downloadSingle = async (tableId: string) => {
    const url = buildTableUrl(selectedOutlet, tableId);
    const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark: "#160800", light: "#ffffff" } });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${selectedOutlet}-${tableId}.png`;
    a.click();
  };

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-[#160800]">Table QR Codes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate per-table QR codes for dine-in ordering. Customer scans → menu → order + pay on their phone.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Outlet</label>
          <select
            value={selectedOutlet}
            onChange={(e) => { setSelectedOutlet(e.target.value); setGenerated(false); }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
          >
            {OUTLETS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Number of tables</label>
          <input
            type="number"
            min={1}
            max={50}
            value={tableCount}
            onChange={(e) => { setTableCount(Math.max(1, Math.min(50, Number(e.target.value)))); setGenerated(false); }}
            className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
          />
        </div>
        <button
          onClick={generate}
          className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
        >
          <Sparkles className="h-4 w-4" /> Generate
        </button>
        {generated && (
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 border border-gray-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Printer className="h-4 w-4" /> Print all
          </button>
        )}
      </div>

      {/* QR grid */}
      {generated && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 print:grid-cols-3 print:gap-4">
          {tables.map((tableId) => {
            const url = buildTableUrl(selectedOutlet, tableId);
            return (
              <div
                key={tableId}
                className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-4 print:break-inside-avoid print:border print:shadow-none"
              >
                <canvas
                  ref={(el) => { if (el) canvasRefs.current.set(tableId, el); }}
                  className="h-[200px] w-[200px]"
                />
                <p className="mt-3 text-xl font-bold text-[#160800]">{tableId}</p>
                <p className="text-xs text-gray-500 text-center">{outletName}</p>
                <p className="mt-1 max-w-[180px] truncate text-[10px] text-gray-400">{url}</p>
                <button
                  onClick={() => downloadSingle(tableId)}
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
