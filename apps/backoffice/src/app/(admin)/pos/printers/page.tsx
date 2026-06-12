"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Printer, Edit2, X } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * POS Printers — manage physical printers per outlet and the station
 * they serve (Bar / Counter / Kitchen). Each row maps to one printer
 * on the outlet's LAN. When an order rings up, the POS register's
 * print pipeline groups items by `products.kitchen_station` and POSTs
 * each station's docket to the matching printer's IP via the local
 * print bridge (localhost:8080).
 *
 * Workflow:
 *   1. Add a row per physical printer (one per Bar / Counter /
 *      Kitchen station, plus one Receipt printer).
 *   2. Set the printer's LAN IP (port defaults to 9100 = ESC/POS raw).
 *   3. Toggle is_enabled off to temporarily disable without losing
 *      the IP config.
 *
 * Without a row for a station, the POS falls back to printing
 * everything on the SUNMI built-in printer at the counter (one
 * combined slip).
 */

type Printer = {
  id: string;
  outlet_id: string;
  name: string;
  printer_type: "docket" | "receipt";
  station: string | null;
  connection_type: "network" | "usb" | "bluetooth" | "built_in";
  ip_address: string | null;
  port: number | null;
  is_enabled: boolean;
};

// Outlet labels come from the shared registry so every app shows the
// same string — see packages/shared/src/outlets.ts. No mall suffix.
import { OUTLET_OPTIONS } from "@celsius/shared";
const OUTLETS = OUTLET_OPTIONS;

const STATION_OPTIONS = ["Bar", "Counter", "Kitchen"] as const;
const CONNECTION_OPTIONS = [
  { value: "network",  label: "Network (LAN)" },
  { value: "usb",      label: "USB" },
  { value: "bluetooth",label: "Bluetooth" },
  { value: "built_in", label: "Built-in (SUNMI)" },
] as const;

function blankRow(outletId: string): Omit<Printer, "id"> {
  return {
    outlet_id: outletId,
    name: "",
    printer_type: "docket",
    station: "Bar",
    connection_type: "network",
    ip_address: "",
    port: 9100,
    is_enabled: true,
  };
}

export default function POSPrintersPage() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [outletId, setOutletId] = useState<string>(OUTLETS[0].id);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Printer | (Omit<Printer, "id"> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch("/api/pos/printers");
      const json = await res.json();
      setPrinters((json.printers ?? []) as Printer[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const outletPrinters = printers.filter((p) => p.outlet_id === outletId);

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const isNew = !("id" in editing) || !editing.id;
      const res = await adminFetch("/api/pos/printers", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      toast.success(isNew ? "Printer added" : "Printer updated");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete printer "${name}"? The POS will fall back to the built-in printer for this station.`)) return;
    try {
      const res = await adminFetch(`/api/pos/printers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Delete failed");
      }
      toast.success("Printer removed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleToggle(p: Printer) {
    try {
      const res = await adminFetch("/api/pos/printers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, is_enabled: !p.is_enabled }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Toggle failed");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">POS Printers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Physical printers per outlet. Each docket printer serves one station; receipt printers handle the customer slip.
          </p>
        </div>
        <button
          onClick={() => setEditing(blankRow(outletId))}
          className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Printer
        </button>
      </div>

      {/* Outlet tabs */}
      <div className="bg-white rounded-2xl p-2 inline-flex gap-1">
        {OUTLETS.map((o) => {
          const count = printers.filter((p) => p.outlet_id === o.id).length;
          const isActive = o.id === outletId;
          return (
            <button
              key={o.id}
              onClick={() => setOutletId(o.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                isActive ? "bg-[#160800] text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {o.label} {count > 0 && <span className={`ml-1 text-xs ${isActive ? "text-white/70" : "text-gray-400"}`}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Printer table */}
      {outletPrinters.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <Printer className="h-12 w-12 mx-auto text-gray-300" />
          <p className="mt-4 text-sm text-gray-500">No printers configured for this outlet yet.</p>
          <p className="mt-1 text-xs text-gray-400">The POS will fall back to the built-in printer for every station.</p>
          <button
            onClick={() => setEditing(blankRow(outletId))}
            className="mt-4 inline-flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
          >
            <Plus className="h-4 w-4" /> Add the first printer
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Station</th>
                <th className="px-4 py-3">Connection</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Enabled</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outletPrinters.map((p) => (
                <tr key={p.id} className={p.is_enabled ? "" : "opacity-50"}>
                  <td className="px-4 py-3 font-medium text-[#160800]">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.printer_type === "docket"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-700"
                    }`}>
                      {p.printer_type === "docket" ? "Kitchen docket" : "Customer receipt"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.station ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{p.connection_type}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    {p.ip_address ? `${p.ip_address}:${p.port ?? 9100}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(p)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        p.is_enabled ? "bg-green-500" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          p.is_enabled ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(p)}
                      className="p-1.5 text-gray-400 hover:text-[#160800] hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-1"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Helper note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
        <p className="font-semibold mb-1">Setup checklist</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Each station printer needs a static LAN IP. Use the printer&apos;s web UI or the manufacturer&apos;s app to assign one.</li>
          <li>Port defaults to <code className="font-mono">9100</code> (raw ESC/POS). Most thermal printers use this.</li>
          <li>The POS device must be able to reach each printer on the LAN (same subnet, no firewall block).</li>
          <li>Once configured, the POS auto-routes each item to the matching station printer based on <code className="font-mono">products.kitchen_station</code>.</li>
          <li>Without a printer row for a station, that station&apos;s docket falls back to the SUNMI built-in printer.</li>
        </ul>
      </div>

      {/* Edit / Add modal */}
      {editing && (
        <PrinterModal
          row={editing}
          saving={saving}
          onChange={setEditing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PrinterModal({
  row,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  row: Printer | (Omit<Printer, "id"> & { id?: string });
  saving: boolean;
  onChange: (next: Printer | (Omit<Printer, "id"> & { id?: string })) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const isNew = !("id" in row) || !row.id;
  const isDocket = row.printer_type === "docket";
  const isNetwork = row.connection_type === "network";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[#160800]">
            {isNew ? "Add Printer" : "Edit Printer"}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name">
            <input
              type="text"
              value={row.name}
              onChange={(e) => onChange({ ...row, name: e.target.value })}
              placeholder='e.g. "Bar Printer", "Kitchen 80mm"'
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
            />
          </Field>

          <Field label="Type">
            <select
              value={row.printer_type}
              onChange={(e) => onChange({ ...row, printer_type: e.target.value as "docket" | "receipt", station: e.target.value === "receipt" ? null : (row.station ?? "Bar") })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
            >
              <option value="docket">Kitchen docket (Bar / Counter / Kitchen)</option>
              <option value="receipt">Customer receipt</option>
            </select>
          </Field>

          {isDocket && (
            <Field label="Station">
              <select
                value={row.station ?? "Bar"}
                onChange={(e) => onChange({ ...row, station: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
              >
                {STATION_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Connection">
            <select
              value={row.connection_type}
              onChange={(e) => onChange({ ...row, connection_type: e.target.value as Printer["connection_type"] })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none"
            >
              {CONNECTION_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>

          {isNetwork && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Field label="IP address">
                  <input
                    type="text"
                    value={row.ip_address ?? ""}
                    onChange={(e) => onChange({ ...row, ip_address: e.target.value })}
                    placeholder="192.168.1.100"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none font-mono"
                  />
                </Field>
              </div>
              <Field label="Port">
                <input
                  type="number"
                  value={row.port ?? 9100}
                  onChange={(e) => onChange({ ...row, port: parseInt(e.target.value, 10) || 9100 })}
                  placeholder="9100"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#160800] focus:outline-none font-mono"
                />
              </Field>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row.is_enabled}
              onChange={(e) => onChange({ ...row, is_enabled: e.target.checked })}
              className="rounded"
            />
            <span>Enabled</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !row.name}
            className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isNew ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      {children}
    </div>
  );
}
