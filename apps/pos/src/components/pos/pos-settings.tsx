"use client";

import { usePOS } from "@/lib/pos-context";

export function POSSettings() {
  const { outlet, register, staff } = usePOS();

  const sections = [
    {
      title: "Register Info",
      items: [
        { label: "Branch", value: outlet?.name ?? "—" },
        { label: "Branch Code", value: outlet?.id ?? "—" },
        { label: "Register", value: register?.name ?? "—" },
        { label: "Staff", value: staff?.name ?? "—" },
        { label: "Role", value: staff?.role ?? "—" },
      ],
    },
    {
      title: "Printer",
      items: [
        { label: "Receipt Printer", value: "Not Connected" },
        { label: "Kitchen Printer", value: "Not Connected" },
        { label: "Paper Size", value: "80mm" },
      ],
    },
    {
      title: "Payment Terminals",
      items: [
        { label: "GHL Terminal", value: "Not Connected" },
        { label: "Revenue Monster", value: "Configured" },
      ],
    },
    {
      title: "Display",
      items: [
        { label: "Theme", value: "Dark" },
        { label: "Product Grid Columns", value: "6 (change in BackOffice Settings)" },
        { label: "Show Product Images", value: "Yes" },
      ],
    },
    {
      title: "Sync",
      items: [
        { label: "Last Sync", value: "Not synced" },
        { label: "Products", value: "13 items loaded" },
        { label: "Categories", value: "5 categories" },
      ],
    },
  ];

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">POS Settings</h1>
      <p className="mt-1 text-sm text-text-muted">{outlet?.name ?? "—"} &middot; {register?.name ?? "—"}</p>

      <div className="mt-6 space-y-4">
        {sections.map((section) => (
          <div key={section.title} className="rounded-xl border border-border bg-surface-raised">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-xs font-semibold text-text-muted">{section.title}</h3>
            </div>
            <div className="divide-y divide-border">
              {section.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Sync button */}
        <button className="w-full rounded-xl border border-border bg-surface-raised py-3 text-sm font-semibold transition-colors hover:bg-surface-hover">
          Sync Now
        </button>

        {/* App info */}
        <div className="text-center text-xs text-text-dim">
          <p>Celsius POS v1.0.0</p>
          <p>celsius.coffee</p>
        </div>
      </div>
    </div>
  );
}
