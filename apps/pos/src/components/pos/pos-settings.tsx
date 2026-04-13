"use client";

import { useState, useEffect } from "react";
import { usePOS } from "@/lib/pos-context";
import { isSunmiDevice, formatReceipt } from "@/lib/sunmi-printer";
import { isCapacitorNative } from "@/lib/sunmi-capacitor";
import SunmiPrinter from "@/lib/sunmi-capacitor";

function usePrinterStatus() {
  const [status, setStatus] = useState<{ receipt: string; method: string }>({
    receipt: "Checking...",
    method: "unknown",
  });

  useEffect(() => {
    async function detect() {
      if (isCapacitorNative()) {
        try {
          const { connected } = await SunmiPrinter.isConnected();
          setStatus({
            receipt: connected ? "SUNMI (Native)" : "SUNMI Not Ready",
            method: "native",
          });
        } catch {
          setStatus({ receipt: "SUNMI (Error)", method: "native" });
        }
      } else if (isSunmiDevice()) {
        setStatus({ receipt: "SUNMI (JS Bridge)", method: "jsbridge" });
      } else {
        setStatus({ receipt: "Browser Print", method: "browser" });
      }
    }
    detect();
  }, []);

  return status;
}

export function POSSettings() {
  const { outlet, register, staff } = usePOS();
  const printer = usePrinterStatus();
  const [testResult, setTestResult] = useState<string | null>(null);

  async function handleTestPrint() {
    setTestResult("Printing...");
    try {
      const testOrder = {
        order_number: "TEST-001",
        order_type: "takeaway",
        queue_number: "T99",
        subtotal: 1500,
        service_charge: 0,
        discount_amount: 0,
        total: 1500,
        created_at: new Date().toISOString(),
        pos_order_items: [
          { product_name: "Latte", variant_name: "Hot", quantity: 1, unit_price: 1500, modifier_total: 0, item_total: 1500, modifiers: [], notes: null },
        ],
        pos_order_payments: [
          { payment_method: "Cash", amount: 1500 },
        ],
      };
      const outletInfo = {
        name: outlet?.name ?? "Celsius Coffee",
        address: outlet?.address,
        city: outlet?.city,
        state: outlet?.state,
        phone: outlet?.phone,
      };
      const { header, body, footer } = formatReceipt(testOrder, outletInfo);

      if (isCapacitorNative()) {
        await SunmiPrinter.printFormattedReceipt({ header, body, footer });
        setTestResult("Printed (Native)");
      } else if (isSunmiDevice()) {
        const bridge = (window as any).sunmiInnerPrinter ?? (window as any).PrinterManager;
        bridge?.printerInit?.();
        bridge?.setFontSize?.(24);
        const plainText = header + "\n" + body + "\n" + footer;
        bridge?.printText?.(plainText);
        bridge?.cutPaper?.();
        setTestResult("Printed (JS Bridge)");
      } else {
        const plainText = header + "\n" + body + "\n" + footer;
        const w = window.open("", "_blank", "width=400,height=600");
        if (w) {
          w.document.write(`<html><head><title>Test Print</title><style>body{font-family:monospace;font-size:12px;width:80mm;margin:0;padding:4mm;white-space:pre-wrap;}</style></head><body>${plainText}</body></html>`);
          w.document.close();
          w.focus();
          w.print();
          setTimeout(() => w.close(), 2000);
        }
        setTestResult("Printed (Browser)");
      }
      setTimeout(() => setTestResult(null), 4000);
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : "Failed"}`);
      setTimeout(() => setTestResult(null), 5000);
    }
  }

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
        { label: "Receipt Printer", value: printer.receipt },
        { label: "Print Method", value: printer.method },
        { label: "Paper Size", value: "58mm" },
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

        {/* Test Print button */}
        <button
          onClick={handleTestPrint}
          className="w-full rounded-xl border border-brand/40 bg-brand/10 py-3 text-sm font-semibold text-brand transition-colors hover:bg-brand/20"
        >
          {testResult ?? "Test Print"}
        </button>

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
