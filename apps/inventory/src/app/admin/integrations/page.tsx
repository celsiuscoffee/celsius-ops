"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  Check,
  AlertTriangle,
  Clock,
  Plug,
  ArrowDownToLine,
  Store,
  Receipt,
  Package,
  Users,
  Settings,
  ExternalLink,
} from "lucide-react";

// StoreHub sync status
const STOREHUB_STATUS = {
  connected: true,
  lastSync: "01/04/2026, 14:30",
  outlets: [
    { name: "Celsius Coffee IOI Conezion", storehubId: "SH-IOI-001", status: "synced" as const, lastSync: "01/04/2026, 14:30", productCount: 85, todaySales: 42 },
    { name: "Celsius Coffee Shah Alam", storehubId: "SH-SHA-001", status: "synced" as const, lastSync: "01/04/2026, 14:25", productCount: 85, todaySales: 38 },
    { name: "Celsius Coffee Tamarind", storehubId: "SH-TMR-001", status: "synced" as const, lastSync: "01/04/2026, 14:20", productCount: 85, todaySales: 31 },
    { name: "Celsius Coffee Nilai", storehubId: "SH-NLI-001", status: "error" as const, lastSync: "31/03/2026, 23:45", productCount: 85, todaySales: 0 },
  ],
};

// Synced product categories from StoreHub
const SYNCED_PRODUCTS = {
  totalProducts: 85,
  categories: [
    { name: "Coffee", count: 24 },
    { name: "Non-Coffee", count: 18 },
    { name: "Food", count: 15 },
    { name: "Pastry", count: 12 },
    { name: "Add-ons", count: 8 },
    { name: "Merchandise", count: 5 },
    { name: "Others", count: 3 },
  ],
  lastPull: "01/04/2026, 08:00",
};

// Today's sales summary from StoreHub
const SALES_SUMMARY = {
  totalTransactions: 111,
  grossSales: 3245.00, // Gross sales, discounts excluded
  topItems: [
    { name: "Iced Latte", qty: 28, gross: 336.00 },
    { name: "Hot Americano", qty: 22, gross: 198.00 },
    { name: "Caramel Latte", qty: 18, gross: 252.00 },
    { name: "Oat Milk Latte", qty: 15, gross: 225.00 },
    { name: "Smoked Duck Sandwich", qty: 12, gross: 192.00 },
  ],
  ingredientsConsumed: [
    { name: "Fresh Milk", consumed: 12.6, uom: "L", cost: 63.00 },
    { name: "Espresso Shot", consumed: 2490, uom: "ml", cost: 124.50 },
    { name: "Oatmilk (Oatside)", consumed: 3.0, uom: "btl", cost: 156.00 },
    { name: "Monin Caramel Syrup", consumed: 360, uom: "ml", cost: 18.72 },
    { name: "Plastic Cup", consumed: 83, uom: "pcs", cost: 3.32 },
  ],
};

// Bukku status
const BUKKU_STATUS = {
  connected: false,
  lastSync: null,
};

const SYNC_CONFIGS = [
  { id: "products", label: "Product Catalog", icon: Package, description: "Menu items, modifiers, categories from StoreHub", frequency: "Daily at 8:00 AM", enabled: true },
  { id: "sales", label: "Sales Transactions", icon: Receipt, description: "Gross sales data (discounts excluded) for COGS calculation", frequency: "Hourly", enabled: true },
  { id: "employees", label: "Employee Data", icon: Users, description: "Staff list and timesheets from StoreHub", frequency: "Weekly", enabled: false },
];

export default function IntegrationsPage() {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bukkuDialog, setbukkuDialog] = useState(false);

  const triggerSync = (id: string) => {
    setSyncingId(id);
    setTimeout(() => setSyncingId(null), 2000);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Integrations</h2>
          <p className="mt-0.5 text-sm text-gray-500">Connect StoreHub POS and Bukku accounting</p>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {/* ─── STOREHUB POS ───────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-sm">SH</div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">StoreHub POS</h3>
                    <Badge className="bg-green-500 text-[10px]">Connected</Badge>
                  </div>
                  <p className="text-xs text-gray-500">Source of truth for products and sales data</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => triggerSync("all")}>
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncingId === "all" ? "animate-spin" : ""}`} />
                  Sync All
                </Button>
                <Button variant="outline" size="sm"><Settings className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Outlet mapping */}
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Outlet Mapping</h4>
              <div className="space-y-1.5">
                {STOREHUB_STATUS.outlets.map((outlet) => (
                  <div key={outlet.storehubId} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      {outlet.status === "synced" ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{outlet.name}</p>
                        <p className="text-[10px] text-gray-400">{outlet.storehubId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-gray-500">{outlet.productCount} products</span>
                      <span className="text-gray-500">{outlet.todaySales} sales today</span>
                      <span className="flex items-center gap-1 text-gray-400"><Clock className="h-3 w-3" />{outlet.lastSync}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sync configuration */}
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Sync Configuration</h4>
              <div className="space-y-1.5">
                {SYNC_CONFIGS.map((config) => {
                  const Icon = config.icon;
                  return (
                    <div key={config.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon className="h-4 w-4" /></div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{config.label}</p>
                          <p className="text-xs text-gray-500">{config.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{config.frequency}</span>
                        <Badge variant="outline" className={`text-[10px] ${config.enabled ? "border-green-300 text-green-600" : "text-gray-400"}`}>
                          {config.enabled ? "Active" : "Disabled"}
                        </Badge>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => triggerSync(config.id)} disabled={syncingId === config.id}>
                          <RefreshCw className={`mr-1 h-3 w-3 ${syncingId === config.id ? "animate-spin" : ""}`} />
                          Sync Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Synced products summary */}
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Synced Product Catalog</h4>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{SYNCED_PRODUCTS.totalProducts} menu items synced</span>
                  <span className="text-xs text-gray-400">Last pull: {SYNCED_PRODUCTS.lastPull}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SYNCED_PRODUCTS.categories.map((cat) => (
                    <Badge key={cat.name} variant="outline" className="text-[10px]">{cat.name} ({cat.count})</Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Today's sales from StoreHub */}
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-700">Today&apos;s Sales (Gross, Discounts Excluded)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-white px-3 py-2.5">
                  <p className="text-xs text-gray-500">Transactions</p>
                  <p className="text-xl font-bold text-gray-900">{SALES_SUMMARY.totalTransactions}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2.5">
                  <p className="text-xs text-gray-500">Gross Sales</p>
                  <p className="text-xl font-bold text-green-600">RM {SALES_SUMMARY.grossSales.toFixed(2)}</p>
                </div>
              </div>

              {/* Top selling items */}
              <div className="mt-3 rounded-lg border border-gray-100 bg-white overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Top Items</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Qty</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Gross (RM)</th>
                  </tr></thead>
                  <tbody>
                    {SALES_SUMMARY.topItems.map((item) => (
                      <tr key={item.name} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 text-gray-900">{item.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{item.qty}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-900">{item.gross.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Ingredients consumed (calculated from sales × recipes) */}
              <div className="mt-3 rounded-lg border border-gray-100 bg-white overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Ingredients Consumed (from sales)</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Used</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Cost (RM)</th>
                  </tr></thead>
                  <tbody>
                    {SALES_SUMMARY.ingredientsConsumed.map((ing) => (
                      <tr key={ing.name} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 text-gray-900">{ing.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{ing.consumed} {ing.uom}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-900">{ing.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50">
                      <td className="px-3 py-1.5 font-semibold text-gray-700">Total COGS Today</td>
                      <td className="px-3 py-1.5"></td>
                      <td className="px-3 py-1.5 text-right font-bold text-gray-900">RM {SALES_SUMMARY.ingredientsConsumed.reduce((a, i) => a + i.cost, 0).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>

        {/* ─── BUKKU ACCOUNTING ───────────────────────── */}
        <Card className="overflow-hidden">
          <div className="border-b border-gray-100 bg-gradient-to-r from-purple-50 to-white px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-600 text-white font-bold text-sm">B</div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">Bukku Accounting</h3>
                    <Badge variant="outline" className="text-[10px] text-gray-400">Not Connected</Badge>
                  </div>
                  <p className="text-xs text-gray-500">Auto-sync POs, invoices, and credit notes to accounting</p>
                </div>
              </div>
              <Button onClick={() => setbukkuDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                <Plug className="mr-1.5 h-4 w-4" />
                Connect Bukku
              </Button>
            </div>
          </div>
          <div className="p-5">
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
              <p className="text-sm text-gray-500">Connect your Bukku account to automatically sync:</p>
              <div className="mt-3 flex justify-center gap-4 text-xs text-gray-400">
                <span>Purchase Orders → Bills</span>
                <span>|</span>
                <span>Invoices → AP</span>
                <span>|</span>
                <span>Credit Notes → Adjustments</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Bukku connect dialog */}
      <Dialog open={bukkuDialog} onOpenChange={setbukkuDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Connect Bukku</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="text-sm font-medium">Bukku API Key</label><Input className="mt-1" placeholder="Enter your Bukku API key" type="password" /></div>
            <div><label className="text-sm font-medium">Company ID</label><Input className="mt-1" placeholder="Your Bukku company ID" /></div>
            <Button className="w-full bg-purple-600 hover:bg-purple-700">Connect</Button>
            <p className="text-center text-xs text-gray-400">Find your API key in Bukku → Settings → API</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
