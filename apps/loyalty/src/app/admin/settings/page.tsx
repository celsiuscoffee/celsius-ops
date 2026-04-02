"use client";

import { useState, useEffect } from "react";
import {
  Copy,
  Download,
  QrCode,
  Link,
  Settings,
  Store,
  Wifi,
  WifiOff,
  RefreshCw,
  Key,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  Info,
} from "lucide-react";
import { fetchOutlets } from "@/lib/api";
import type { Outlet } from "@/types";

interface OutletMapping {
  outletId: string;
  outletName: string;
  storeId: string;
}

export default function SettingsPage() {
  // Sidebar navigation
  const [activeTab, setActiveTab] = useState<"settings" | "points" | "qr" | "storehub">(
    "settings"
  );

  // Outlets from API
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);

  // Settings state
  const [pointsPerRm, setPointsPerRm] = useState(1);
  const [logoPreview, setLogoPreview] = useState<string | null>(
    "/images/celsius-logo-sm.jpg"
  );

  // QR Code & Link state
  const [registerLink] = useState("https://celsius.loyalty/rewards");
  const [welcomeText, setWelcomeText] = useState(
    "Join our Loyalty program for amazing rewards!"
  );
  const [subDescription, setSubDescription] = useState(
    "Fill in the details below to register."
  );
  const [collectName, setCollectName] = useState(false);
  const [collectEmail, setCollectEmail] = useState(false);
  const [collectBirthday, setCollectBirthday] = useState(false);

  // StoreHub state
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "testing" | "connected" | "failed"
  >("idle");
  const [lastTested, setLastTested] = useState<string | null>(null);
  const [outletMappings, setOutletMappings] = useState<OutletMapping[]>([]);
  const [autoDetectPurchases, setAutoDetectPurchases] = useState(true);
  const [detectionWindow, setDetectionWindow] = useState("10");

  // Points settings state
  const [pointsExpiryEnabled, setPointsExpiryEnabled] = useState(false);
  const [pointsExpiryMonths, setPointsExpiryMonths] = useState(6);
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false);
  const [dailyEarningLimit, setDailyEarningLimit] = useState(0);

  // Fetch outlets and brand settings on mount
  useEffect(() => {
    Promise.all([
      fetchOutlets(),
      fetch("/api/brands").then((r) => r.json()),
    ]).then(([outletData, brands]) => {
      setOutlets(outletData);
      setOutletMappings(
        outletData.map((o) => ({
          outletId: o.id,
          outletName: o.name,
          storeId: o.storehub_store_id || "",
        }))
      );
      // Load brand settings
      const brand = Array.isArray(brands) ? brands.find((b: Record<string, unknown>) => b.id === "brand-celsius") : null;
      if (brand) {
        if (brand.points_per_rm != null) setPointsPerRm(brand.points_per_rm);
        if (brand.points_expiry_enabled != null) setPointsExpiryEnabled(brand.points_expiry_enabled);
        if (brand.points_expiry_months != null) setPointsExpiryMonths(brand.points_expiry_months);
        if (brand.daily_earning_limit != null) {
          setDailyEarningLimit(brand.daily_earning_limit);
          setDailyLimitEnabled(brand.daily_earning_limit > 0);
        }
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(registerLink);
  };

  const removeLogo = () => {
    setLogoPreview(null);
  };

  // StoreHub handlers
  const testConnection = async () => {
    setConnectionStatus("testing");
    try {
      const res = await fetch("/api/storehub/test");
      if (res.ok) {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("failed");
      }
    } catch {
      setConnectionStatus("failed");
    }
    setLastTested(new Date().toLocaleString());
  };

  const updateOutletMapping = (outletId: string, storeId: string) => {
    setOutletMappings((prev) =>
      prev.map((m) => (m.outletId === outletId ? { ...m, storeId } : m))
    );
  };

  // Sidebar nav items
  const sidebarItems = [
    { key: "settings" as const, label: "Settings", icon: Settings },
    { key: "points" as const, label: "Points", icon: Timer },
    { key: "qr" as const, label: "QR Code & Link", icon: QrCode },
    { key: "storehub" as const, label: "StoreHub", icon: Store },
  ];

  return (
    <div className="flex h-full min-h-[calc(100vh-80px)]">
      {/* Left Sidebar */}
      <div className="w-[180px] shrink-0 border-r border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900 p-4">
        <nav className="space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                activeTab === item.key
                  ? "bg-white dark:bg-neutral-800 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-neutral-700"
                  : "text-gray-600 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Right Content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        {activeTab === "settings" ? (
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Point Value */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Point Value
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
                Set on how many points earned for every RM spent
              </p>
              <div className="mt-5 flex items-center gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                    RM Spent
                  </label>
                  <input
                    type="text"
                    value="RM 1.00"
                    disabled
                    className="w-32 rounded-lg border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm font-sans text-gray-400"
                  />
                </div>
                <span className="mt-6 text-gray-400 dark:text-neutral-500">=</span>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Points Earned
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={pointsPerRm}
                      onChange={(e) =>
                        setPointsPerRm(parseInt(e.target.value) || 1)
                      }
                      className="w-20 rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 text-center focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                    <span className="text-sm text-gray-500 dark:text-neutral-400">points</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload Logo */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Company Logo
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
                Company logo has to be 1:1 (Square) dimension. File must be PNG
                or JPEG
              </p>

              <div className="mt-5 flex items-center gap-5">
                {logoPreview ? (
                  <div className="h-20 w-20 overflow-hidden rounded-xl border border-gray-200">
                    <img
                      src={logoPreview}
                      alt="Company logo"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400">
                    <span className="text-xs">No logo</span>
                  </div>
                )}
                {logoPreview && (
                  <button
                    onClick={removeLogo}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <button className="rounded-lg border border-gray-200 dark:border-neutral-600 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/brands", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: "brand-celsius",
                        points_per_rm: pointsPerRm,
                      }),
                    });
                    if (res.ok) alert("Settings saved!");
                    else alert("Failed to save settings");
                  } catch {
                    alert("Failed to save settings");
                  }
                }}
                className="rounded-lg bg-[#C2452D] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : activeTab === "points" ? (
          /* Points Tab */
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Points Expiry */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Points Expiry
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
                Points will expire after the selected period from when they were earned. Expired points are automatically deducted.
              </p>

              <div className="mt-5 space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Enable Points Expiry
                    </p>
                  </div>
                  <button
                    onClick={() => setPointsExpiryEnabled(!pointsExpiryEnabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      pointsExpiryEnabled
                        ? "bg-[#C2452D]"
                        : "bg-gray-200 dark:bg-neutral-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        pointsExpiryEnabled
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Expiry period selector */}
                {pointsExpiryEnabled && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                      Expiry Period
                    </label>
                    <select
                      value={pointsExpiryMonths}
                      onChange={(e) => setPointsExpiryMonths(parseInt(e.target.value))}
                      className="rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-700 dark:text-neutral-300 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    >
                      <option value={3}>3 months</option>
                      <option value={6}>6 months</option>
                      <option value={12}>12 months</option>
                      <option value={18}>18 months</option>
                      <option value={24}>24 months</option>
                    </select>
                  </div>
                )}

                {/* FIFO info box */}
                <div className="flex items-start gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    When customers redeem points, the points closest to expiring are used first (FIFO).
                  </p>
                </div>
              </div>
            </div>

            {/* Daily Earning Limit */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Daily Earning Limit
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
                Limit how many times a customer can earn points per day to prevent misuse.
              </p>

              <div className="mt-5 space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Enable Daily Earning Limit
                    </p>
                  </div>
                  <button
                    onClick={() => setDailyLimitEnabled(!dailyLimitEnabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      dailyLimitEnabled
                        ? "bg-[#C2452D]"
                        : "bg-gray-200 dark:bg-neutral-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        dailyLimitEnabled
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Limit input */}
                {dailyLimitEnabled && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                      Max earning transactions per day
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={dailyEarningLimit}
                        onChange={(e) =>
                          setDailyEarningLimit(parseInt(e.target.value) || 0)
                        }
                        className="w-24 rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm font-sans text-gray-900 dark:text-neutral-200 text-center focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                      <span className="text-sm text-gray-500 dark:text-neutral-400">
                        {dailyEarningLimit === 0 ? "(0 = unlimited)" : "per day"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <button className="rounded-lg border border-gray-200 dark:border-neutral-600 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/brands", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: "brand-celsius",
                        points_per_rm: pointsPerRm,
                        points_expiry_enabled: pointsExpiryEnabled,
                        points_expiry_months: pointsExpiryMonths,
                        daily_earning_limit: dailyLimitEnabled ? dailyEarningLimit : 0,
                      }),
                    });
                    if (res.ok) alert("Points settings saved!");
                    else alert("Failed to save points settings");
                  } catch (err) {
                    alert("Failed to save points settings");
                  }
                }}
                className="rounded-lg bg-[#C2452D] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : activeTab === "qr" ? (
          /* QR Code & Link View */
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Sharing Section */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Sharing
              </h2>

              {/* Register link */}
              <div className="mt-5">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-neutral-400">
                  <Link className="h-3.5 w-3.5" />
                  Register link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={registerLink}
                    readOnly
                    className="flex-1 rounded-lg border border-gray-200 dark:border-neutral-600 bg-gray-50 dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-700 dark:text-neutral-300"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 dark:border-neutral-600 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
                    title="Copy link"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* QR Code */}
              <div className="mt-6">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-neutral-400">
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code
                </label>
                <div className="flex items-start gap-6">
                  {/* QR placeholder */}
                  <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border-2 border-gray-300 bg-white">
                    <div className="text-center">
                      <QrCode className="mx-auto h-16 w-16 text-gray-800" />
                      <span className="mt-1 block text-[10px] text-gray-400">
                        QR Code
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3 pt-1">
                    <p className="text-sm text-gray-500 dark:text-neutral-400">
                      You can print this or download the image
                    </p>
                    <div className="flex gap-2">
                      <button className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-neutral-600 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                        <Download className="h-4 w-4" />
                        Download PNG
                      </button>
                      <button className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-neutral-600 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                        <Download className="h-4 w-4" />
                        Download SVG
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Register Page Settings */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Register Page Settings
              </h2>

              <div className="mt-5 space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Register page welcoming text
                  </label>
                  <textarea
                    value={welcomeText}
                    onChange={(e) => setWelcomeText(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] resize-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Sub description text
                  </label>
                  <textarea
                    value={subDescription}
                    onChange={(e) => setSubDescription(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-neutral-200 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D] resize-none"
                  />
                </div>

                {/* Properties checkboxes */}
                <div>
                  <label className="mb-3 block text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Properties
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="h-4 w-4 rounded border-gray-300 text-[#C2452D] accent-[#C2452D]"
                      />
                      <span className="text-sm text-gray-500 dark:text-neutral-400">
                        Phone number{" "}
                        <span className="text-xs text-gray-400 dark:text-neutral-500">
                          (Required by system)
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectName}
                        onChange={(e) => setCollectName(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-[#C2452D] accent-[#C2452D]"
                      />
                      <span className="text-sm text-gray-700 dark:text-neutral-300">Name</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectEmail}
                        onChange={(e) => setCollectEmail(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-[#C2452D] accent-[#C2452D]"
                      />
                      <span className="text-sm text-gray-700 dark:text-neutral-300">Email</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectBirthday}
                        onChange={(e) => setCollectBirthday(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-[#C2452D] accent-[#C2452D]"
                      />
                      <span className="text-sm text-gray-700 dark:text-neutral-300">Birthday</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <button className="rounded-lg border border-gray-200 dark:border-neutral-600 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  alert("QR & Link settings saved!");
                }}
                className="rounded-lg bg-[#C2452D] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          /* StoreHub Tab */
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Connection Status Card */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    StoreHub POS Integration
                  </h2>
                  <div className="mt-2 flex items-center gap-2">
                    {connectionStatus === "connected" ? (
                      <>
                        <span className="flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                        </span>
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          Connected
                        </span>
                      </>
                    ) : connectionStatus === "failed" ? (
                      <>
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                        <span className="text-sm font-medium text-red-600 dark:text-red-400">
                          Disconnected
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-neutral-600" />
                        <span className="text-sm text-gray-500 dark:text-neutral-400">
                          Not tested
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={testConnection}
                  disabled={connectionStatus === "testing"}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#C2452D] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      connectionStatus === "testing" ? "animate-spin" : ""
                    }`}
                  />
                  {connectionStatus === "testing"
                    ? "Testing..."
                    : "Test Connection"}
                </button>
              </div>

              {/* Inline status message */}
              {connectionStatus === "connected" && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  <span className="text-sm text-green-700 dark:text-green-300">
                    Successfully connected to StoreHub API
                  </span>
                </div>
              )}
              {connectionStatus === "failed" && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  <span className="text-sm text-red-700 dark:text-red-300">
                    Failed to connect. Check your API credentials.
                  </span>
                </div>
              )}

              {lastTested && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500">
                  <Clock className="h-3 w-3" />
                  Last tested: {lastTested}
                </p>
              )}
            </div>

            {/* Outlet Mapping Card */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-gray-500 dark:text-neutral-400" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Outlet &harr; Store ID Mapping
                </h2>
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
                Map each outlet to its StoreHub store ID
              </p>

              <div className="mt-5 space-y-1">
                {/* Table header */}
                <div className="flex items-center gap-3 px-1 pb-2">
                  <span className="w-36 text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Outlet
                  </span>
                  <span className="flex-1 text-xs font-medium text-gray-500 dark:text-neutral-400">
                    StoreHub Store ID
                  </span>
                  <span className="w-10 text-xs font-medium text-gray-500 dark:text-neutral-400 text-center">
                    Status
                  </span>
                </div>

                {/* Mapping rows */}
                {outletMappings.map((mapping) => (
                  <div
                    key={mapping.outletId}
                    className="flex items-center gap-3 rounded-lg py-2 px-1"
                  >
                    <span className="w-36 text-sm font-medium text-gray-700 dark:text-neutral-300 truncate">
                      {mapping.outletName}
                    </span>
                    <input
                      type="text"
                      value={mapping.storeId}
                      onChange={(e) =>
                        updateOutletMapping(mapping.outletId, e.target.value)
                      }
                      placeholder="Enter store ID"
                      className="flex-1 rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3.5 py-2 text-sm font-mono text-gray-900 dark:text-neutral-200 placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                    <div className="flex w-10 items-center justify-center">
                      {mapping.storeId ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <span className="text-gray-300 dark:text-neutral-600">
                          &mdash;
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sync Settings Card */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-gray-500 dark:text-neutral-400" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Auto-Sync Settings
                </h2>
              </div>

              <div className="mt-5 space-y-5">
                {/* Auto-detect toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Auto-detect purchases
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">
                      Automatically detect and match purchases from StoreHub
                    </p>
                  </div>
                  <button
                    onClick={() => setAutoDetectPurchases(!autoDetectPurchases)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      autoDetectPurchases
                        ? "bg-[#C2452D]"
                        : "bg-gray-200 dark:bg-neutral-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        autoDetectPurchases
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Detection window */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Detection window
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">
                      Time window to match tablet stamps with POS transactions
                    </p>
                  </div>
                  <select
                    value={detectionWindow}
                    onChange={(e) => setDetectionWindow(e.target.value)}
                    className="rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 px-3 py-2 text-sm text-gray-700 dark:text-neutral-300 focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  >
                    <option value="5">5 minutes</option>
                    <option value="10">10 minutes</option>
                    <option value="15">15 minutes</option>
                  </select>
                </div>

                {/* Sync interval (disabled) */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Sync interval
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">
                      How often to check for new transactions
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-2 text-sm text-gray-500 dark:text-neutral-400">
                    <Wifi className="h-3.5 w-3.5" />
                    Real-time via tablet
                  </span>
                </div>
              </div>
            </div>

            {/* API Credentials Card */}
            <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-gray-500 dark:text-neutral-400" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  API Credentials
                </h2>
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-neutral-400">
                    API URL
                  </span>
                  <span className="font-mono text-sm text-gray-700 dark:text-neutral-300">
                    https://api.store***.com/v1
                  </span>
                </div>
                <div className="border-t border-gray-100 dark:border-neutral-700" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-neutral-400">
                    Username
                  </span>
                  <span className="font-mono text-sm text-gray-700 dark:text-neutral-300">
                    celsius_api
                  </span>
                </div>
                <div className="border-t border-gray-100 dark:border-neutral-700" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-neutral-400">
                    API Key
                  </span>
                  <span className="font-mono text-sm text-gray-700 dark:text-neutral-300">
                    ****************************a1b2
                  </span>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
                <Key className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Credentials are configured in environment variables and cannot
                  be edited here for security reasons.
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <button className="rounded-lg border border-gray-200 dark:border-neutral-600 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    // Save outlet mappings
                    for (const mapping of outletMappings) {
                      if (mapping.storeId) {
                        await fetch("/api/outlets", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: mapping.outletId,
                            storehub_store_id: mapping.storeId,
                          }),
                        });
                      }
                    }
                    alert("StoreHub settings saved!");
                  } catch {
                    alert("Failed to save StoreHub settings");
                  }
                }}
                className="rounded-lg bg-[#C2452D] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A33822] transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
