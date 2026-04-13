"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<any | null>(null);
  const [selectedOutletId, setSelectedOutletId] = useState<string>("");
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: o } = await supabase.from("outlets").select("*").order("name");
      setOutlets(o ?? []);
      if (o && o.length > 0) {
        const outletId = o[0].id;
        setSelectedOutletId(outletId);
        const { data: s } = await supabase.from("pos_branch_settings").select("*").eq("outlet_id", outletId).single();
        setSettings(s);
        const { data: ks } = await supabase.from("pos_kitchen_stations").select("*").eq("outlet_id", outletId).order("sort_order");
        setStations(ks ?? []);
        const { data: pr } = await supabase.from("pos_printer_config").select("*").eq("outlet_id", outletId).order("created_at");
        setPrinters(pr ?? []);
      }
    }
    load();
  }, [supabase]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await supabase.from("pos_branch_settings").upsert(settings);
    setSaving(false);
    alert("Settings saved!");
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-text-muted">Configure your branch, register, and system settings</p>

      <div className="mt-6 grid grid-cols-2 gap-6">
        {/* Branch Settings */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Branch Settings</h3></div>
          <div className="space-y-3 p-4">
            <div><label className="mb-1 block text-xs text-text-muted">Branch Name</label><input type="text" defaultValue="Celsius Coffee Shah Alam" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            <div><label className="mb-1 block text-xs text-text-muted">Address</label><input type="text" defaultValue="Shah Alam, Selangor" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            <div><label className="mb-1 block text-xs text-text-muted">Phone</label><input type="tel" defaultValue="+603-1234-5678" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs text-text-muted">Service Charge (%)</label><input type="number" defaultValue="0" step="1" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
              <div><label className="mb-1 block text-xs text-text-muted">Default Order Type</label><select defaultValue="takeaway" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="takeaway">Takeaway</option><option value="dine_in">Dine-in</option></select></div>
            </div>
            <div><label className="mb-1 block text-xs text-text-muted">Checkout Option</label><select defaultValue="queue_number" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="queue_number">Auto Queue Number</option><option value="table_number">Table Number</option><option value="none">None</option></select></div>
            <div><label className="mb-1 block text-xs text-text-muted">Product Grid Columns</label><select defaultValue="6" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="4">4 (Large)</option><option value="5">5 (Medium)</option><option value="6">6 (Default)</option><option value="7">7 (Compact)</option><option value="8">8 (Small)</option></select></div>
          </div>
        </div>

        {/* Receipt Settings */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Receipt Settings</h3></div>
          <div className="space-y-3 p-4">
            <div><label className="mb-1 block text-xs text-text-muted">Receipt Header</label><input type="text" value={settings?.receipt_header ?? ""} onChange={(e) => setSettings({ ...settings, receipt_header: e.target.value })} placeholder="Celsius Coffee" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            <div><label className="mb-1 block text-xs text-text-muted">Receipt Footer</label><input type="text" value={settings?.receipt_footer ?? ""} onChange={(e) => setSettings({ ...settings, receipt_footer: e.target.value })} placeholder="Thank you for visiting!" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={settings?.receipt_show_logo !== false} onChange={(e) => setSettings({ ...settings, receipt_show_logo: e.target.checked })} className="peer sr-only" />
                <div className="h-5 w-9 rounded-full bg-surface-hover after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-brand peer-checked:after:translate-x-full" />
              </label>
              <span className="text-xs text-text-muted">Show logo on receipt</span>
            </div>
          </div>
        </div>

        {/* QR Code (Google Review) */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">QR Code on Receipt</h3></div>
          <div className="space-y-3 p-4">
            <p className="text-[10px] text-text-dim">Add a QR code to the bottom of receipts. Great for Google Reviews, social media, or feedback forms.</p>
            <div><label className="mb-1 block text-xs text-text-muted">QR Code URL</label><input type="url" value={settings?.receipt_qr_url ?? ""} onChange={(e) => setSettings({ ...settings, receipt_qr_url: e.target.value })} placeholder="https://g.page/r/your-google-review-link" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" /></div>
            <div><label className="mb-1 block text-xs text-text-muted">Label above QR Code</label><input type="text" value={settings?.receipt_qr_label ?? ""} onChange={(e) => setSettings({ ...settings, receipt_qr_label: e.target.value })} placeholder="Scan to leave us a review!" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
            {settings?.receipt_qr_url && (
              <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-white">
                  <svg viewBox="0 0 24 24" className="h-10 w-10 text-text-dim"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm11-2h2v2h-2v-2zm-4 0h2v2h-2v-2zm4 4h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm2-4h2v2h-2v-2z"/></svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-text">QR code will print on receipts</p>
                  <p className="text-[10px] text-text-dim break-all">{settings.receipt_qr_url}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Promotions on Receipt */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Promotion on Receipt</h3>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={settings?.receipt_promo_enabled === true} onChange={(e) => setSettings({ ...settings, receipt_promo_enabled: e.target.checked })} className="peer sr-only" />
              <div className="h-5 w-9 rounded-full bg-surface-hover after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-brand peer-checked:after:translate-x-full" />
            </label>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-[10px] text-text-dim">Print a promotional message on every receipt. Supports multiple lines.</p>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Promotion Text</label>
              <textarea
                rows={3}
                value={settings?.receipt_promo_text ?? ""}
                onChange={(e) => setSettings({ ...settings, receipt_promo_text: e.target.value })}
                placeholder={"Buy 5 drinks, get 1 FREE!\nAsk about our loyalty program"}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand resize-none"
              />
            </div>
            {settings?.receipt_promo_enabled && settings?.receipt_promo_text && (
              <div className="rounded-lg border border-dashed border-brand/30 bg-brand/5 p-3">
                <p className="text-[10px] font-semibold text-brand uppercase tracking-wide mb-1">Preview</p>
                <p className="whitespace-pre-wrap text-xs font-semibold text-text">{settings.receipt_promo_text}</p>
              </div>
            )}
          </div>
        </div>

        {/* Payment Terminals */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Payment Terminals</h3></div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs text-text-muted">GHL Merchant ID</label><input type="text" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" placeholder="MID" /></div>
              <div><label className="mb-1 block text-xs text-text-muted">GHL Terminal ID</label><input type="text" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" placeholder="TID" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs text-text-muted">Revenue Monster Merchant ID</label><input type="text" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" /></div>
              <div><label className="mb-1 block text-xs text-text-muted">RM Environment</label><select className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option>Sandbox</option><option>Production</option></select></div>
            </div>
            <p className="text-[10px] text-text-dim">Payment methods: Card (GHL), Touch &apos;n Go, GrabPay, FPX, Boost via Revenue Monster</p>
          </div>
        </div>

        {/* Kitchen Stations */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Kitchen Stations</h3>
            <button className="text-xs text-brand hover:underline">+ Add Station</button>
          </div>
          <div className="divide-y divide-border">
            {[{ name: "Bar", products: 9 }, { name: "Kitchen", products: 4 }].map((s) => (
              <div key={s.name} className="flex items-center justify-between px-4 py-3">
                <div><p className="text-sm font-medium">{s.name}</p><p className="text-[10px] text-text-dim">{s.products} products assigned</p></div>
                <button className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-hover">Edit</button>
              </div>
            ))}
          </div>
        </div>

        {/* Printer Routing */}
        <div className="col-span-2 rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Printer Routing</h3>
            <button onClick={() => setEditingPrinter({ outlet_id: selectedOutletId, name: "", printer_type: "docket", station: "", connection_type: "network", ip_address: "", port: 9100, is_enabled: true })} className="text-xs text-brand hover:underline">+ Add Printer</button>
          </div>
          <div className="p-4">
            <p className="text-xs text-text-dim mb-3">Configure which printer handles receipts and which handles kitchen dockets per station.</p>

            {/* Printer edit form */}
            {editingPrinter && (
              <div className="mb-4 rounded-lg border border-brand/30 bg-brand/5 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="mb-1 block text-xs text-text-muted">Printer Name</label><input type="text" value={editingPrinter.name} onChange={(e) => setEditingPrinter({ ...editingPrinter, name: e.target.value })} placeholder="e.g. Bar Docket Printer" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand" /></div>
                  <div><label className="mb-1 block text-xs text-text-muted">Type</label><select value={editingPrinter.printer_type} onChange={(e) => setEditingPrinter({ ...editingPrinter, printer_type: e.target.value })} className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="receipt">Receipt</option><option value="docket">Kitchen Docket</option></select></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="mb-1 block text-xs text-text-muted">Station</label><select value={editingPrinter.station ?? ""} onChange={(e) => setEditingPrinter({ ...editingPrinter, station: e.target.value || null })} className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="">— None (All) —</option>{stations.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}<option value="Counter">Counter</option><option value="Bar">Bar</option><option value="Kitchen">Kitchen</option></select></div>
                  <div><label className="mb-1 block text-xs text-text-muted">Connection</label><select value={editingPrinter.connection_type} onChange={(e) => setEditingPrinter({ ...editingPrinter, connection_type: e.target.value })} className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand"><option value="network">Network (IP)</option><option value="usb">USB</option><option value="bluetooth">Bluetooth</option><option value="built_in">Built-in (SUNMI)</option></select></div>
                  <div><label className="mb-1 block text-xs text-text-muted">IP Address</label><div className="flex gap-2"><input type="text" value={editingPrinter.ip_address ?? ""} onChange={(e) => setEditingPrinter({ ...editingPrinter, ip_address: e.target.value })} placeholder="192.168.1.100" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" /><input type="number" value={editingPrinter.port ?? 9100} onChange={(e) => setEditingPrinter({ ...editingPrinter, port: parseInt(e.target.value) || 9100 })} className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-sm text-text font-mono outline-none focus:border-brand" /></div></div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    <input type="checkbox" checked={editingPrinter.is_enabled} onChange={(e) => setEditingPrinter({ ...editingPrinter, is_enabled: e.target.checked })} className="rounded" />
                    Enabled
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingPrinter(null)} className="rounded-lg border border-border px-4 py-1.5 text-xs text-text-muted hover:bg-surface-hover">Cancel</button>
                    <button onClick={async () => {
                      if (!editingPrinter.name) { alert("Printer name required"); return; }
                      if (editingPrinter.id) {
                        await supabase.from("pos_printer_config").update({ ...editingPrinter, updated_at: new Date().toISOString() }).eq("id", editingPrinter.id);
                      } else {
                        await supabase.from("pos_printer_config").insert(editingPrinter);
                      }
                      const { data: pr } = await supabase.from("pos_printer_config").select("*").eq("outlet_id", selectedOutletId).order("created_at");
                      setPrinters(pr ?? []);
                      setEditingPrinter(null);
                    }} className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark">{editingPrinter.id ? "Update" : "Add"} Printer</button>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead><tr className="border-b border-border bg-surface text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-2">Printer</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Connection</th><th className="px-4 py-2">Station</th><th className="px-4 py-2">Status</th><th className="px-4 py-2"></th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {/* Built-in SUNMI printer (always present) */}
                  <tr className="hover:bg-surface-hover">
                    <td className="px-4 py-2 text-sm font-medium">SUNMI Built-in</td>
                    <td className="px-4 py-2 text-xs text-text-muted">Receipt + Docket (80mm)</td>
                    <td className="px-4 py-2 text-xs font-mono text-text-muted">Built-in</td>
                    <td className="px-4 py-2 text-xs text-text-muted">All</td>
                    <td className="px-4 py-2"><span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-medium text-success">Default</span></td>
                    <td className="px-4 py-2 text-right text-xs text-text-dim">Auto-detected</td>
                  </tr>
                  {printers.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-2 text-sm font-medium">{p.name}</td>
                      <td className="px-4 py-2 text-xs text-text-muted">{p.printer_type === "receipt" ? "Receipt (80mm)" : "Kitchen Docket (80mm)"}</td>
                      <td className="px-4 py-2 text-xs font-mono text-text-muted">{p.connection_type === "network" ? `${p.ip_address || "—"}:${p.port}` : p.connection_type}</td>
                      <td className="px-4 py-2 text-xs text-text-muted">{p.station || "All"}</td>
                      <td className="px-4 py-2">{p.is_enabled ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-medium text-warning">Configured</span> : <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-text-dim">Disabled</span>}</td>
                      <td className="px-4 py-2 text-right flex gap-2 justify-end">
                        <button onClick={() => setEditingPrinter({ ...p })} className="text-xs text-text-muted hover:text-text">Edit</button>
                        <button onClick={async () => {
                          if (!confirm("Delete this printer?")) return;
                          await supabase.from("pos_printer_config").delete().eq("id", p.id);
                          setPrinters(printers.filter((x: any) => x.id !== p.id));
                        }} className="text-xs text-danger/60 hover:text-danger">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {printers.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-text-dim">No external printers configured. All printing routes to the SUNMI built-in printer.<br/>Add a printer to route kitchen dockets to a dedicated station printer.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-text-dim">Printers connect via ESC/POS protocol over network (port 9100) or USB. The print bridge at localhost:8080 handles routing to external printers.</p>
          </div>
        </div>

        {/* Tax Codes */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Tax Codes</h3>
            <button className="text-xs text-brand hover:underline">+ Add</button>
          </div>
          <div className="divide-y divide-border">
            {[{ name: "No Tax", code: "NOTAX", rate: "0%" }, { name: "SST 6%", code: "SST6", rate: "6%" }, { name: "SST 8%", code: "SST8", rate: "8%" }].map((t) => (
              <div key={t.code} className="flex items-center justify-between px-4 py-2.5">
                <div><p className="text-sm font-medium">{t.name}</p><p className="text-[10px] font-mono text-text-dim">{t.code}</p></div>
                <span className="text-sm text-text-muted">{t.rate}</span>
              </div>
            ))}
          </div>
        </div>

        {/* e-Invoice */}
        <div className="rounded-xl border border-border bg-surface-raised">
          <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">e-Invoice (LHDN)</h3></div>
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-warning" /><span className="text-xs text-warning">Not configured</span></div>
            <p className="text-[10px] text-text-dim">LHDN e-Invoice compliance requires TIN, BRN, and MSIC code. Configure before the compliance deadline.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs text-text-muted">TIN</label><input type="text" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" /></div>
              <div><label className="mb-1 block text-xs text-text-muted">BRN</label><input type="text" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text font-mono outline-none focus:border-brand" /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end"><button className="rounded-lg bg-brand px-6 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Save Settings</button></div>
    </div>
  );
}
