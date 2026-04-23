"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Search,
  Settings,
  Plus,
  MoreHorizontal,
  Calendar,
  Filter,
  X,
  ChevronDown,
  DollarSign,
  Zap,
  Download,
  Eye,
  Pencil,
  Trash2,
  Clock,
  Bell,
  Gift,
  MessageSquare,
  Send,
  Phone,
  Pause,
  Play,
} from "lucide-react";
import { fetchCampaigns } from "@/lib/loyalty/api";
import type { Campaign } from "@/lib/loyalty/types";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/loyalty/export";

// ---------------------------------------------------------------------------
// Local campaign type used for display
// ---------------------------------------------------------------------------
type CampaignStatus =
  | "active"
  | "draft"
  | "completed"
  | "paused"
  | "archived"
  | "scheduled";

type CampaignType =
  | "multiplier"
  | "bonus"
  | "cash_rebate"
  | "buy1free1"
  | "custom";

interface LocalCampaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  periodStart: string | null;
  periodEnd: string | null;
  customers: number;
  redeemedCount: number;
  redeemedTotal: number;
  conversion: number;
}

// ---------------------------------------------------------------------------
// Map API Campaign to LocalCampaign for display
// ---------------------------------------------------------------------------
function mapApiCampaign(c: Campaign): LocalCampaign {
  const now = new Date();
  const start = new Date(c.start_date);
  const end = new Date(c.end_date);

  let status: CampaignStatus;
  if (!c.is_active) {
    // If it has valid dates and was within active period, it was paused (not draft)
    status = (start && end && now >= start && now <= end) ? "paused" : "paused";
  } else if (now < start) {
    status = "scheduled";
  } else if (now > end) {
    status = "completed";
  } else {
    status = "active";
  }

  // Map the API type to the local type
  const validTypes: CampaignType[] = ["multiplier", "bonus", "cash_rebate", "buy1free1", "custom"];
  const type: CampaignType = validTypes.includes(c.type as CampaignType) ? (c.type as CampaignType) : "custom";

  return {
    id: c.id,
    name: c.name,
    type,
    status,
    periodStart: c.start_date,
    periodEnd: c.end_date,
    customers: 0,
    redeemedCount: 0,
    redeemedTotal: 0,
    conversion: 0,
  };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const statusDotColor: Record<CampaignStatus, string> = {
  active: "bg-green-500",
  draft: "bg-yellow-400",
  completed: "bg-blue-500",
  paused: "bg-gray-400",
  archived: "bg-red-500",
  scheduled: "bg-purple-500",
};

const statusBadge: Record<
  CampaignStatus,
  { bg: string; text: string; label: string }
> = {
  active: { bg: "bg-green-50", text: "text-green-700", label: "Active" },
  draft: { bg: "bg-yellow-50", text: "text-yellow-700", label: "Draft" },
  completed: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    label: "Completed",
  },
  paused: { bg: "bg-gray-100", text: "text-gray-600", label: "Paused" },
  archived: { bg: "bg-red-50", text: "text-red-700", label: "Archived" },
  scheduled: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    label: "Scheduled",
  },
};

const tabs: { key: CampaignStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

const campaignTypeOptions: { value: CampaignType; label: string }[] = [
  { value: "multiplier", label: "Point multiplier" },
  { value: "bonus", label: "Bonus points" },
  { value: "cash_rebate", label: "Cash rebate" },
  { value: "buy1free1", label: "Buy 1 Free 1" },
  { value: "custom", label: "Custom offer" },
];

const segmentOptions = [
  { value: "all", label: "All members" },
  { value: "new", label: "New customers" },
  { value: "returning", label: "Returning customers" },
  { value: "inactive", label: "Inactive members (30+ days)" },
  { value: "birthday", label: "Birthday this month" },
  { value: "eligible", label: "Eligible to redeem" },
  { value: "custom", label: "Custom filter" },
];

// Combined SMS templates: campaign type × segment
// Key: "type:segment"
const combinedTemplates: Record<string, string> = {
  // Multiplier
  "multiplier:all":       "Hi {name}! Earn DOUBLE points at Celsius Coffee today! Every RM spent = 2x points. Visit us now!",
  "multiplier:new":       "Welcome {name}! Start strong with 2X POINTS on your first visit to Celsius Coffee. Join & earn more!",
  "multiplier:returning": "Hey {name}! You've earned {points} pts so far. Earn 2X POINTS today at Celsius Coffee. Don't miss out!",
  "multiplier:inactive":  "We miss you {name}! Come back to Celsius Coffee & enjoy 2X POINTS on your next visit. See you soon!",
  "multiplier:eligible":  "{name}, you have {points} pts! Earn 2X POINTS today at Celsius Coffee & redeem your rewards faster!",
  // Bonus
  "bonus:all":       "Hi {name}! Get BONUS points at Celsius Coffee today! Extra points on every purchase. Visit us now!",
  "bonus:new":       "Welcome {name}! Get BONUS points on your first Celsius Coffee visit. Start earning rewards today!",
  "bonus:returning": "Hey {name}! Enjoy BONUS points on your next visit to Celsius Coffee. You have {points} pts — earn more!",
  "bonus:inactive":  "We miss you {name}! Come back & get BONUS points at Celsius Coffee. It's been a while!",
  "bonus:eligible":  "{name}, you have {points} pts! Get BONUS points at Celsius Coffee today & redeem even more rewards!",
  // Cash rebate
  "cash_rebate:all":       "Hi {name}! Enjoy a CASH REBATE at Celsius Coffee! Visit any outlet to claim your savings.",
  "cash_rebate:new":       "Welcome {name}! Get a CASH REBATE on your first Celsius Coffee purchase. Visit us today!",
  "cash_rebate:returning": "Hey {name}! Enjoy a special CASH REBATE at Celsius Coffee. Thanks for being a loyal fan!",
  "cash_rebate:inactive":  "We miss you {name}! Come back & enjoy a CASH REBATE at Celsius Coffee. See you soon!",
  "cash_rebate:eligible":  "{name}, you have {points} pts! Plus enjoy a CASH REBATE at Celsius Coffee today!",
  // Buy 1 Free 1
  "buy1free1:all":       "Hi {name}! BUY 1 FREE 1 at Celsius Coffee! Grab your drink & get another FREE. Visit us today!",
  "buy1free1:new":       "Welcome {name}! Enjoy BUY 1 FREE 1 on your first Celsius Coffee visit. Bring a friend!",
  "buy1free1:returning": "Hey {name}! BUY 1 FREE 1 at Celsius Coffee just for you. Thanks for being loyal!",
  "buy1free1:inactive":  "We miss you {name}! Come back & enjoy BUY 1 FREE 1 at Celsius Coffee. See you soon!",
  "buy1free1:eligible":  "{name}, you have {points} pts! Plus enjoy BUY 1 FREE 1 at Celsius Coffee today!",
  // Birthday — sent during the member's birthday month
  "multiplier:birthday":  "Happy Birthday {name}! Earn 2X POINTS all month at Celsius Coffee. Celebrate with us!",
  "bonus:birthday":       "Happy Birthday {name}! Enjoy BONUS points at Celsius Coffee this month. Our treat!",
  "cash_rebate:birthday": "Happy Birthday {name}! Enjoy a CASH REBATE at Celsius Coffee this month. Our treat!",
  "buy1free1:birthday":   "Happy Birthday {name}! BUY 1 FREE 1 at Celsius Coffee this month. Show this SMS at any outlet.",
  // Custom — empty, user writes their own
  "custom:all": "",
  "custom:new": "",
  "custom:returning": "",
  "custom:inactive": "",
  "custom:birthday": "",
  "custom:eligible": "",
  "custom:custom": "",
};

function getCampaignTemplate(type: CampaignType, segment: string): string {
  return combinedTemplates[`${type}:${segment}`] || combinedTemplates[`${type}:all`] || "";
}

type FilterField =
  | "points_balance"
  | "total_visits"
  | "total_spend"
  | "last_visit"
  | "joined_date";
type FilterOp = ">" | "<" | "=" | "within";

interface CustomFilter {
  field: FilterField;
  op: FilterOp;
  value: string;
}

const filterFieldLabels: Record<FilterField, string> = {
  points_balance: "Points balance",
  total_visits: "Total visits",
  total_spend: "Total spend",
  last_visit: "Last visit",
  joined_date: "Joined date",
};

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "No period limit";
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  const s = start ? new Date(start).toLocaleDateString("en-MY", opts) : "";
  const e = end ? new Date(end).toLocaleDateString("en-MY", opts) : "";
  if (s && e) return `${s} - ${e}`;
  if (s) return `From ${s}`;
  return `Until ${e}`;
}

type Channel = "sms";

const variables = [
  { key: "{name}", preview: "Ahmad" },
  { key: "{points}", preview: "150" },
  { key: "{outlet}", preview: "Celsius Bangsar" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CampaignsPage() {
  const [campaignData, setCampaignData] = useState<LocalCampaign[]>([]);
  const [rawCampaigns, setRawCampaigns] = useState<Campaign[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingCampaign, setViewingCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      // Don't close if clicking inside the dropdown or confirm popup
      const target = e.target as HTMLElement;
      if (target.closest('[data-campaign-menu]')) return;
      setOpenMenu(null);
      setDeleteConfirm(null);
      setMenuPos(null);
    }
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [openMenu]);

  const [activeTab, setActiveTab] = useState<CampaignStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<CampaignType>("multiplier");
  const [formSegment, setFormSegment] = useState("all");
  const [formNoPeriodLimit, setFormNoPeriodLimit] = useState(true);
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formMultiplier, setFormMultiplier] = useState("2");
  const [formBonusPoints, setFormBonusPoints] = useState("");
  const [formRebateAmount, setFormRebateAmount] = useState("");
  const [formCustomDesc, setFormCustomDesc] = useState("");
  const [formInactiveDays, setFormInactiveDays] = useState("30");
  const [formChannel, setFormChannel] = useState<Channel>("sms");
  const [formMessage, setFormMessage] = useState("");
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([
    { field: "points_balance", op: ">", value: "" },
  ]);

  const charLimit = 160;

  const insertVariable = (variable: string) => {
    setFormMessage((prev) => prev + variable);
  };

  const campaignHeader = "[CelsiusCoffee]\n";
  const fullCampaignMessage = campaignHeader + formMessage;

  const previewText = useMemo(() => {
    let text = fullCampaignMessage || "Your message preview will appear here...";
    variables.forEach((v) => {
      text = text.replaceAll(v.key, v.preview);
    });
    return text;
  }, [fullCampaignMessage]);

  // Load campaigns from API
  useEffect(() => {
    fetchCampaigns().then((data) => {
      setRawCampaigns(data);
      setCampaignData(data.map(mapApiCampaign));
      setLoading(false);
    });
  }, []);

  // ─── Delete handler ────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/loyalty/campaigns?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setCampaignData((prev) => prev.filter((c) => c.id !== id));
        setRawCampaigns((prev) => prev.filter((c) => c.id !== id));
      } else {
        const result = await res.json();
        alert(`Failed to delete campaign: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      alert("Failed to delete campaign. Please try again.");
    }
    setDeleteConfirm(null);
    setOpenMenu(null);
    setMenuPos(null);
  }

  // ─── Pause / Resume handler ─────────────────────────
  async function handleTogglePause(id: string) {
    const raw = rawCampaigns.find((c) => c.id === id);
    if (!raw) return;
    const newActive = !raw.is_active;
    try {
      const res = await fetch(`/api/loyalty/campaigns?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: newActive }),
      });
      if (res.ok) {
        setRawCampaigns((prev) =>
          prev.map((c) => (c.id === id ? { ...c, is_active: newActive } : c))
        );
        setCampaignData((prev) =>
          prev.map((c) => (c.id === id ? mapApiCampaign({ ...raw, is_active: newActive }) : c))
        );
      }
    } catch {}
    setOpenMenu(null);
    setMenuPos(null);
  }

  // ─── Edit handler (pre-fill form) ────────────────────
  function handleEdit(id: string) {
    const raw = rawCampaigns.find((c) => c.id === id);
    if (!raw) return;
    // Reset all fields first to avoid stale values
    resetForm();
    setEditingId(id);
    setFormName(raw.name);
    // Map API type to form type
    const reverseTypeMap: Record<string, CampaignType> = {
      multiplier: "multiplier",
      bonus: "bonus",
      cash_rebate: "cash_rebate",
      buy1free1: "buy1free1",
      custom: "custom",
    };
    setFormType(reverseTypeMap[raw.type] || "custom");
    // Map API segment to form segment
    const reverseSegmentMap: Record<string, string> = {
      all: "all",
      new: "new",
      active: "returning",
      inactive: "inactive",
      birthday: "birthday",
      eligible: "eligible",
      custom: "custom",
    };
    setFormSegment(reverseSegmentMap[raw.target_segment] || "all");
    // Period
    setFormStartDate(raw.start_date ? raw.start_date.split("T")[0] : "");
    setFormEndDate(raw.end_date ? raw.end_date.split("T")[0] : "");
    const tenYears = 9 * 365 * 24 * 60 * 60 * 1000;
    const endMs = new Date(raw.end_date).getTime();
    setFormNoPeriodLimit(endMs - Date.now() > tenYears);
    // Values
    setFormMultiplier(raw.multiplier ? String(raw.multiplier) : "2");
    setFormBonusPoints(raw.bonus_points ? String(raw.bonus_points) : "");
    setFormCustomDesc(raw.description || "");
    setFormMessage(raw.message || "");
    setShowCreateModal(true);
    setOpenMenu(null);
    setMenuPos(null);
  }

  // ─── Create / Update handler ────────────────────────────────
  async function handleCreate() {
    if (!formName.trim()) return;

    const isEdit = !!editingId;
    const typeMap: Record<CampaignType, string> = {
      multiplier: "multiplier",
      bonus: "bonus",
      cash_rebate: "cash_rebate",
      buy1free1: "buy1free1",
      custom: "custom",
    };
    const segmentMap: Record<string, string> = {
      all: "all",
      new: "new",
      returning: "active",
      inactive: "inactive",
      birthday: "birthday",
      eligible: "eligible",
      custom: "custom",
    };
    const body: Record<string, unknown> = {
      brand_id: "brand-celsius",
      name: formName.trim(),
      type: typeMap[formType] || formType,
      target_segment: segmentMap[formSegment] || formSegment,
      is_active: true,
    };
    if (!formNoPeriodLimit) {
      body.start_date = formStartDate ? new Date(formStartDate).toISOString() : new Date().toISOString();
      body.end_date = formEndDate ? new Date(formEndDate).toISOString() : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    } else if (isEdit && formStartDate) {
      // Preserve original dates when editing with no period limit
      body.start_date = new Date(formStartDate).toISOString();
      body.end_date = formEndDate ? new Date(formEndDate).toISOString() : new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      body.start_date = new Date().toISOString();
      body.end_date = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (formType === "multiplier") body.multiplier = parseFloat(formMultiplier) || 2;
    if (formType === "bonus") body.bonus_points = parseFloat(formBonusPoints) || 0;
    if (formType === "custom") body.description = formCustomDesc;
    // Store trigger info in description for automated campaigns (strip existing [AUTO:] prefix)
    const cleanDesc = formCustomDesc.replace(/^\[AUTO:\w+(?::\d+)?\]\s*/g, "");
    if (formSegment === "inactive") {
      body.description = `[AUTO:inactive:${formInactiveDays}] ${cleanDesc || `Re-engage after ${formInactiveDays} days inactivity`}`;
    } else if (formSegment === "birthday") {
      body.description = `[AUTO:birthday] ${cleanDesc || "Birthday reward campaign"}`;
    }

    if (formMessage.trim()) body.message = formMessage.trim();

    try {
      const url = isEdit ? `/api/loyalty/campaigns?id=${editingId}` : "/api/loyalty/campaigns";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (res.ok) {
        if (isEdit) {
          setRawCampaigns((prev) => prev.map((c) => (c.id === editingId ? result : c)));
          setCampaignData((prev) => prev.map((c) => (c.id === editingId ? mapApiCampaign(result) : c)));
        } else {
          setRawCampaigns((prev) => [result, ...prev]);
          setCampaignData((prev) => [mapApiCampaign(result), ...prev]);
        }
      } else {
        console.error("Campaign save error:", result.error);
        alert(`Failed to ${isEdit ? "update" : "create"} campaign: ${result.error || "Unknown error"}`);
        return;
      }
    } catch (err) {
      console.error("Campaign save error:", err);
      alert("Failed to save campaign. Please try again.");
      return;
    }
    setShowCreateModal(false);
    setEditingId(null);
    resetForm();
  }

  const filtered = useMemo(() => {
    let list = campaignData;
    if (activeTab !== "all") {
      list = list.filter((c) => c.status === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  }, [activeTab, searchQuery, campaignData]);

  const activeCampaignCount = campaignData.filter(
    (c) => c.status === "active"
  ).length;

  // Custom filter helpers
  const addFilter = () => {
    setCustomFilters((prev) => [
      ...prev,
      { field: "points_balance", op: ">", value: "" },
    ]);
  };

  const removeFilter = (index: number) => {
    setCustomFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFilter = (
    index: number,
    key: keyof CustomFilter,
    val: string
  ) => {
    setCustomFilters((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, [key]: val } : f
      )
    );
  };

  const resetForm = () => {
    setFormName("");
    setFormType("multiplier");
    setFormSegment("all");
    setFormNoPeriodLimit(true);
    setFormStartDate("");
    setFormEndDate("");
    setFormMultiplier("2");
    setFormBonusPoints("");
    setFormRebateAmount("");
    setFormCustomDesc("");
    setFormInactiveDays("30");
    setFormChannel("sms");
    setFormMessage("");
    setCustomFilters([{ field: "points_balance", op: ">", value: "" }]);
  };

  const isDateField = (f: FilterField) =>
    f === "last_visit" || f === "joined_date";

  if (loading) {
    return (
      <div className="p-6 space-y-6 pb-20 md:pb-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
              <div className="h-12" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center py-20 text-gray-400 dark:text-neutral-500">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 pb-20 md:pb-0">
      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Total sales */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">
                Total sales (All campaigns)
              </p>
              <p className="font-sans text-xl font-bold text-gray-900 dark:text-white">
                RM 0.00
              </p>
            </div>
          </div>
        </div>

        {/* Active campaigns */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <Zap className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">
                Active campaigns
              </p>
              <p className="font-sans text-xl font-bold text-gray-900 dark:text-white">
                {activeCampaignCount}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ── Status Tabs + Actions ─────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 pb-0.5">
          {tabs.map((tab) => {
            const count =
              tab.key === "all"
                ? campaignData.length
                : campaignData.filter((c) => c.status === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex-shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-700 dark:hover:text-neutral-200"
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs",
                      activeTab === tab.key
                        ? "bg-white/20 text-white"
                        : "bg-gray-100 dark:bg-neutral-700 text-gray-500 dark:text-neutral-400"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Search toggle */}
          {showSearch ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="h-9 w-48 rounded-lg border border-gray-300 pl-8 pr-8 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
            >
              <Search className="h-4 w-4" />
            </button>
          )}

          {/* Export */}
          <button
            onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              const rows = filtered.map((c) => ({
                name: c.name,
                type: c.type,
                status: statusBadge[c.status].label,
                period: formatPeriod(c.periodStart, c.periodEnd),
                customers: c.customers,
                redeemed: `${c.redeemedCount}/${c.redeemedTotal}`,
                conversion: c.conversion > 0 ? `${c.conversion}%` : "",
              }));
              exportToCSV(rows, [
                { key: "name", label: "Campaign Name" },
                { key: "type", label: "Type" },
                { key: "status", label: "Status" },
                { key: "period", label: "Active Period" },
                { key: "customers", label: "Customers" },
                { key: "redeemed", label: "Redeemed" },
                { key: "conversion", label: "Conversion" },
              ], `celsius-campaigns-${today}`);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
            title="Export CSV"
          >
            <Download className="h-4 w-4" />
          </button>

          {/* Settings */}
          <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700">
            <Settings className="h-4 w-4" />
          </button>

          {/* Create new */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#C2452D] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822]"
          >
            <Plus className="h-4 w-4" />
            Create new
          </button>
        </div>
      </div>

      {/* ── Campaign Table ────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-700 bg-gray-50/60 dark:bg-neutral-800">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Campaign
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Active period
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Customers
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Redeemed
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Conversion
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-700/50">
              {filtered.map((c) => {
                const badge = statusBadge[c.status];
                return (
                  <tr
                    key={c.id}
                    className="transition-colors hover:bg-gray-50/50 dark:hover:bg-neutral-700/50"
                  >
                    {/* Campaign name */}
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-2 text-left font-medium text-gray-900 dark:text-white hover:text-[#C2452D]">
                        <span
                          className={cn(
                            "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
                            statusDotColor[c.status]
                          )}
                        />
                        {c.name}
                      </button>
                    </td>
                    {/* Active period */}
                    <td className="whitespace-nowrap px-4 py-3 font-sans text-gray-600 dark:text-neutral-400">
                      {formatPeriod(c.periodStart, c.periodEnd)}
                    </td>
                    {/* Customers */}
                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-neutral-300">
                      {c.customers.toLocaleString()}
                    </td>
                    {/* Redeemed */}
                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-neutral-300">
                      {c.redeemedCount.toLocaleString()}/{c.redeemedTotal.toLocaleString()}
                    </td>
                    {/* Conversion */}
                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-neutral-300">
                      {c.conversion > 0 ? `${c.conversion}%` : "—"}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          badge.bg,
                          badge.text
                        )}
                      >
                        {badge.label}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openMenu === c.id) {
                              setOpenMenu(null);
                              setMenuPos(null);
                              setDeleteConfirm(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const spaceBelow = window.innerHeight - rect.bottom;
                              setMenuPos(spaceBelow < 140
                                ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
                                : { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                              );
                              setOpenMenu(c.id);
                              setDeleteConfirm(null);
                            }
                          }}
                          className="rounded-lg p-1.5 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-gray-400 dark:text-neutral-500"
                  >
                    No campaigns found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Fixed-position action dropdown ─── */}
      {openMenu && menuPos && !deleteConfirm && (
        <div
          data-campaign-menu
          style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, zIndex: 50 }}
          className="w-40 overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const raw = rawCampaigns.find((c) => c.id === openMenu);
              if (raw) setViewingCampaign(raw);
              setOpenMenu(null);
              setMenuPos(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Eye className="h-3.5 w-3.5" />
            View Details
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleEdit(openMenu!); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleTogglePause(openMenu!); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            {rawCampaigns.find((c) => c.id === openMenu)?.is_active ? (
              <><Pause className="h-3.5 w-3.5" /> Pause</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> Resume</>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(openMenu); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
      {deleteConfirm && menuPos && (
        <div
          data-campaign-menu
          style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, zIndex: 50 }}
          className="w-56 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-neutral-800 shadow-lg p-3"
        >
          <p className="text-sm text-gray-700 dark:text-neutral-300 mb-2">Delete this campaign?</p>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); setOpenMenu(null); setMenuPos(null); }}
              className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(deleteConfirm); }}
              className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* ── View Details Modal ─────────────────────────────────── */}
      {viewingCampaign && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-10 pb-10"
          onClick={() => setViewingCampaign(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewingCampaign(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">
              Campaign Details
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Name</span>
                <span className="font-medium text-gray-900 dark:text-white">{viewingCampaign.name}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Type</span>
                <span className="font-medium text-gray-900 dark:text-white capitalize">{viewingCampaign.type}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Target Segment</span>
                <span className="font-medium text-gray-900 dark:text-white capitalize">{viewingCampaign.target_segment}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Status</span>
                <span className="font-medium text-gray-900 dark:text-white">{viewingCampaign.is_active ? "Active" : "Inactive"}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Period</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatPeriod(viewingCampaign.start_date, viewingCampaign.end_date)}</span>
              </div>
              {viewingCampaign.multiplier && (
                <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400">Multiplier</span>
                  <span className="font-medium text-gray-900 dark:text-white">{viewingCampaign.multiplier}x</span>
                </div>
              )}
              {viewingCampaign.bonus_points && (
                <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400">Bonus Points</span>
                  <span className="font-medium text-gray-900 dark:text-white">{viewingCampaign.bonus_points}</span>
                </div>
              )}
              {viewingCampaign.description && (
                <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400">Description</span>
                  <span className="font-medium text-gray-900 dark:text-white text-right max-w-[200px]">{viewingCampaign.description}</span>
                </div>
              )}
              {viewingCampaign.message && (
                <div className="border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400 block mb-1">Message</span>
                  <p className="rounded-lg bg-gray-50 dark:bg-neutral-700 p-3 text-gray-900 dark:text-white whitespace-pre-wrap">{viewingCampaign.message}</p>
                </div>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  handleEdit(viewingCampaign.id);
                  setViewingCampaign(null);
                }}
                className="flex-1 rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white hover:bg-[#A93B26]"
              >
                Edit Campaign
              </button>
              <button
                onClick={() => setViewingCampaign(null)}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-4 py-2 text-sm font-medium text-gray-600 dark:text-neutral-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create New Campaign Modal ─────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-6 pb-10">
          <div className="relative w-full max-w-4xl rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl">
            {/* Close */}
            <button
              onClick={() => {
                setShowCreateModal(false);
                setEditingId(null);
                resetForm();
              }}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-5 text-lg font-bold text-gray-900 dark:text-white">
              {editingId ? "Edit campaign" : "Create new campaign"}
            </h2>

            <div className="flex gap-6">
              {/* ─── Left: Form ─── */}
              <div className="flex-1 space-y-4">
                {/* Campaign name */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Campaign name
                  </label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Double Points Weekend"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  />
                </div>

                {/* Campaign type */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Campaign type
                  </label>
                  <div className="relative">
                    <select
                      value={formType}
                      onChange={(e) => {
                        const t = e.target.value as CampaignType;
                        setFormType(t);
                        const tpl = getCampaignTemplate(t, formSegment);
                        if (tpl && !formMessage.trim()) setFormMessage(tpl);
                      }}
                      className="w-full appearance-none rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    >
                      {campaignTypeOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>

                {/* Target segment */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Target segment
                  </label>
                  <div className="relative">
                    <select
                      value={formSegment}
                      onChange={(e) => {
                        setFormSegment(e.target.value);
                        const tpl = getCampaignTemplate(formType, e.target.value);
                        if (tpl && !formMessage.trim()) setFormMessage(tpl);
                      }}
                      className="w-full appearance-none rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    >
                      {segmentOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>

                {/* Inactive trigger info */}
                {formSegment === "inactive" && (
                  <div className="rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-orange-800 dark:text-orange-300">
                      <Clock className="h-4 w-4" />
                      Inactivity trigger
                    </div>
                    <p className="mb-3 text-xs text-orange-700 dark:text-orange-400">
                      Automatically targets members who haven&apos;t visited in the specified number of days.
                    </p>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-orange-800 dark:text-orange-300">Inactive for</label>
                      <input
                        type="number"
                        min="7"
                        max="365"
                        value={formInactiveDays}
                        onChange={(e) => setFormInactiveDays(e.target.value)}
                        className="w-20 rounded-lg border border-orange-300 dark:border-orange-700 bg-white dark:bg-neutral-800 px-2 py-1.5 text-center text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                      <span className="text-sm text-orange-800 dark:text-orange-300">days</span>
                    </div>
                  </div>
                )}

                {/* Birthday trigger info */}
                {formSegment === "birthday" && (
                  <div className="rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50 dark:bg-pink-900/20 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-pink-800 dark:text-pink-300">
                      <Gift className="h-4 w-4" />
                      Birthday trigger
                    </div>
                    <p className="text-xs text-pink-700 dark:text-pink-400">
                      Automatically sends once during each member&apos;s birthday month. Members without a birthday on file are skipped.
                    </p>
                  </div>
                )}

                {/* Custom filter builder */}
                {formSegment === "custom" && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Filter className="h-4 w-4" />
                      Custom filter builder
                    </div>
                    <p className="mb-3 text-xs text-gray-500">
                      All conditions must match (AND logic)
                    </p>

                    <div className="space-y-2">
                      {customFilters.map((filter, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          {/* Field */}
                          <select
                            value={filter.field}
                            onChange={(e) =>
                              updateFilter(
                                idx,
                                "field",
                                e.target.value
                              )
                            }
                            className="w-36 appearance-none rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                          >
                            {(
                              Object.entries(filterFieldLabels) as [
                                FilterField,
                                string,
                              ][]
                            ).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>

                          {/* Operator */}
                          <select
                            value={filter.op}
                            onChange={(e) =>
                              updateFilter(idx, "op", e.target.value)
                            }
                            className="w-20 appearance-none rounded-md border border-gray-300 px-2 py-1.5 text-center text-xs focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                          >
                            {isDateField(filter.field as FilterField) ? (
                              <option value="within">within</option>
                            ) : (
                              <>
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                                <option value="=">=</option>
                              </>
                            )}
                          </select>

                          {/* Value */}
                          <div className="relative flex-1">
                            <input
                              value={filter.value}
                              onChange={(e) =>
                                updateFilter(idx, "value", e.target.value)
                              }
                              placeholder={
                                isDateField(filter.field as FilterField)
                                  ? "e.g. 30"
                                  : "Value"
                              }
                              type="number"
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                            />
                            {isDateField(filter.field as FilterField) && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                                days
                              </span>
                            )}
                          </div>

                          {/* Remove */}
                          {customFilters.length > 1 && (
                            <button
                              onClick={() => removeFilter(idx)}
                              className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={addFilter}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#C2452D] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add filter
                    </button>
                  </div>
                )}

                {/* Active period */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Active period
                  </label>
                  <label className="mb-2 flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={formNoPeriodLimit}
                      onChange={(e) => setFormNoPeriodLimit(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#C2452D] focus:ring-[#C2452D]"
                    />
                    No period limit
                  </label>
                  {!formNoPeriodLimit && (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Calendar className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="date"
                          value={formStartDate}
                          onChange={(e) => setFormStartDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                      <span className="text-gray-400">to</span>
                      <div className="relative flex-1">
                        <Calendar className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="date"
                          value={formEndDate}
                          onChange={(e) => setFormEndDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Reward details — conditional on type */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Reward details
                  </label>
                  {formType === "multiplier" && (
                    <div className="flex items-center gap-2">
                      <input
                        value={formMultiplier}
                        onChange={(e) => setFormMultiplier(e.target.value)}
                        type="number"
                        min={2}
                        className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                      <span className="text-sm text-gray-600">
                        x points multiplier
                      </span>
                    </div>
                  )}
                  {formType === "bonus" && (
                    <div className="flex items-center gap-2">
                      <input
                        value={formBonusPoints}
                        onChange={(e) => setFormBonusPoints(e.target.value)}
                        type="number"
                        placeholder="50"
                        className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                      <span className="text-sm text-gray-600">bonus points</span>
                    </div>
                  )}
                  {formType === "cash_rebate" && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">RM</span>
                      <input
                        value={formRebateAmount}
                        onChange={(e) => setFormRebateAmount(e.target.value)}
                        type="number"
                        placeholder="5.00"
                        step="0.01"
                        className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                      />
                      <span className="text-sm text-gray-600">rebate</span>
                    </div>
                  )}
                  {formType === "buy1free1" && (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                      Buy 1 Free 1 — customers get a free item on qualifying
                      purchase.
                    </p>
                  )}
                  {formType === "custom" && (
                    <textarea
                      value={formCustomDesc}
                      onChange={(e) => setFormCustomDesc(e.target.value)}
                      placeholder="Describe the custom offer..."
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                  )}
                </div>

                {/* Channel selection */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Channel
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-[#C2452D] bg-[#C2452D]/5 px-4 py-2.5 text-sm font-medium text-[#C2452D]">
                      <Phone className="h-4 w-4" />
                      SMS
                    </div>
                  </div>
                </div>

                {/* Message textarea */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Message
                    </label>
                    {getCampaignTemplate(formType, formSegment) && (
                      <button
                        onClick={() => setFormMessage(getCampaignTemplate(formType, formSegment))}
                        className="text-xs font-medium text-[#C2452D] hover:underline"
                      >
                        Use template
                      </button>
                    )}
                  </div>
                  <textarea
                    value={formMessage}
                    onChange={(e) => setFormMessage(e.target.value)}
                    maxLength={charLimit}
                    placeholder="Type your SMS message..."
                    rows={4}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "text-xs",
                        fullCampaignMessage.length > charLimit * 0.9
                          ? "text-red-500"
                          : "text-gray-400"
                      )}
                    >
                      {fullCampaignMessage.length}/{charLimit} characters
                      <span className="text-gray-300"> (incl. header: [CelsiusCoffee])</span>
                    </span>
                  </div>

                  {/* Variable chips */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-400">Variables:</span>
                    {variables.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(v.key)}
                        className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono text-gray-600 transition-colors hover:border-[#C2452D] hover:bg-[#C2452D]/5 hover:text-[#C2452D]"
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ─── Right: Phone Preview ─── */}
              <div className="hidden w-72 flex-shrink-0 md:block">
                <p className="mb-2 text-sm font-medium text-gray-700 dark:text-neutral-300">
                  Preview
                </p>
                <div className="rounded-2xl border border-gray-200 bg-gray-100 p-3">
                  {/* Phone frame */}
                  <div className="mx-auto w-full">
                    {/* Status bar */}
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-[10px] font-medium text-gray-500">
                        9:41
                      </span>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-3 rounded-sm bg-gray-400" />
                        <div className="h-1.5 w-3 rounded-sm bg-gray-400" />
                        <div className="h-2 w-4 rounded-sm border border-gray-400">
                          <div className="h-full w-3/4 rounded-sm bg-gray-400" />
                        </div>
                      </div>
                    </div>

                    {/* Chat header */}
                    <div className="mb-2 rounded-lg bg-blue-500 px-3 py-2">
                      <p className="text-xs font-medium text-white">
                        Celsius Coffee (SMS)
                      </p>
                      <p className="text-[10px] text-white/70">
                        +60 3-5521 1234
                      </p>
                    </div>

                    {/* Chat area */}
                    <div className="min-h-[200px] rounded-lg bg-white p-3">
                      {/* Message bubble */}
                      <div className="max-w-[90%] rounded-xl bg-blue-500 px-3 py-2 text-xs leading-relaxed text-white">
                        <p className="whitespace-pre-wrap">{previewText}</p>
                        <p className="mt-1 text-right text-[9px] text-white/60">
                          {new Date().toLocaleTimeString("en-MY", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Variable legend */}
                <div className="mt-3 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3">
                  <p className="mb-2 text-xs font-medium text-gray-500 dark:text-neutral-400">
                    Preview values
                  </p>
                  <div className="space-y-1">
                    {variables.map((v) => (
                      <div
                        key={v.key}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="font-mono text-gray-400">
                          {v.key}
                        </span>
                        <span className="text-gray-700 dark:text-neutral-300">{v.preview}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 dark:border-neutral-700 pt-4">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingId(null);
                  resetForm();
                }}
                className="rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!formName.trim()}
                className="rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingId ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
