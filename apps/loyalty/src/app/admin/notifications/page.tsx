"use client";

import { useState, useMemo, useEffect } from "react";
import {
  MessageSquare,
  Send,
  Calendar,
  Users,
  Phone,
  Plus,
  Search,
  Filter,
  Clock,
  ChevronDown,
  X,
  MoreHorizontal,
  Download,
  Eye,
  Pencil,
  Trash2,
  CreditCard,
  History,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { cn, formatPhone } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { fetchMembers } from "@/lib/api";
import type { MemberWithBrand } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MessageStatus = "sent" | "scheduled" | "draft";
type Channel = "sms";

interface NotificationMessage {
  id: string;
  message: string;
  channel: Channel;
  audience: string;
  sent: number | null;
  delivered: number | null;
  status: MessageStatus;
  scheduledAt?: string;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------
const demoMessages: NotificationMessage[] = [
  {
    id: "msg-1",
    message: "Welcome to Celsius Loyalty!",
    channel: "sms",
    audience: "New members",
    sent: 156,
    delivered: 154,
    status: "sent",
  },
  {
    id: "msg-2",
    message: "Double Points Weekend!",
    channel: "sms",
    audience: "All members",
    sent: 847,
    delivered: 832,
    status: "sent",
  },
  {
    id: "msg-4",
    message: "Reactivation: We miss you!",
    channel: "sms",
    audience: "Inactive 30d+",
    sent: null,
    delivered: null,
    status: "draft",
  },
];

// ---------------------------------------------------------------------------
// Status & channel helpers
// ---------------------------------------------------------------------------
const statusBadge: Record<
  MessageStatus,
  { bg: string; text: string; label: string }
> = {
  sent: { bg: "bg-green-50", text: "text-green-700", label: "Sent" },
  scheduled: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    label: "Scheduled",
  },
  draft: { bg: "bg-yellow-50", text: "text-yellow-700", label: "Draft" },
};

const channelBadge: Record<
  string,
  { bg: string; text: string; label: string; icon: typeof Phone }
> = {
  sms: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    label: "SMS",
    icon: Phone,
  },
};

const tabs: { key: MessageStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Draft" },
];

const audienceOptions = [
  { value: "all", label: "All members" },
  { value: "new", label: "New members (joined this month)" },
  { value: "returning", label: "Returning customers (3+ visits)" },
  { value: "inactive", label: "Inactive 30+ days" },
  { value: "eligible", label: "Eligible to redeem (300+ pts)" },
  { value: "custom", label: "Custom filter" },
];

// Prefilled SMS templates per segment
const smsTemplates: Record<string, string> = {
  all: "Hi {name}! Celsius Coffee here. Visit us today and earn double points on all drinks. See you soon!",
  new: "Welcome to Celsius Coffee, {name}! Enjoy your membership perks and start earning points on every visit.",
  returning: "Hey {name}! Thanks for being a loyal Celsius Coffee fan. You have {points} pts — treat yourself today!",
  inactive: "We miss you {name}! It's been a while since your last visit. Come back to Celsius Coffee and enjoy a special offer.",
  eligible: "Great news {name}! You have {points} pts ready to redeem at Celsius Coffee. Visit us to claim your reward!",
  custom: "",
};

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

const variables = [
  { key: "{name}", preview: "Ahmad Razak" },
  { key: "{points}", preview: "750" },
  { key: "{outlet}", preview: "Shah Alam" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<MessageStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [messages, setMessages] = useState(() => {
    if (typeof window !== "undefined") {
      const deleted = JSON.parse(sessionStorage.getItem("engage_deleted") || "[]");
      return demoMessages.filter((m) => !deleted.includes(m.id));
    }
    return demoMessages;
  });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [editingMsg, setEditingMsg] = useState<NotificationMessage | null>(null);
  const [viewingMsg, setViewingMsg] = useState<NotificationMessage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-engage-menu]')) return;
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

  // Compose form state
  const [formChannel, setFormChannel] = useState<Channel>("sms");
  const [formSenderId, setFormSenderId] = useState("CelsiusCoffee");
  const [formAudience, setFormAudience] = useState("all");
  const [formMessage, setFormMessage] = useState("");
  const [formScheduleType, setFormScheduleType] = useState<"now" | "later">(
    "now"
  );
  const [formScheduleDate, setFormScheduleDate] = useState("");
  const [formScheduleTime, setFormScheduleTime] = useState("");
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([
    { field: "points_balance", op: ">", value: "" },
  ]);

  const charLimit = 160;

  const filtered = useMemo(() => {
    let list = messages;
    if (activeTab !== "all") {
      list = list.filter((m) => m.status === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => m.message.toLowerCase().includes(q));
    }
    return list;
  }, [activeTab, searchQuery, messages]);

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
      prev.map((f, i) => (i === index ? { ...f, [key]: val } : f))
    );
  };

  const isDateField = (f: FilterField) =>
    f === "last_visit" || f === "joined_date";

  const resetForm = () => {
    setFormChannel("sms");
    setFormAudience("all");
    setFormMessage("");
    setFormScheduleType("now");
    setFormScheduleDate("");
    setFormScheduleTime("");
    setCustomFilters([{ field: "points_balance", op: ">", value: "" }]);
    setEditingMsg(null);
  };

  // SMS credits & log state
  const [smsBalance, setSmsBalance] = useState<number | null>(null);
  const [smsBalanceLoading, setSmsBalanceLoading] = useState(false);
  const [smsSentThisMonth, setSmsSentThisMonth] = useState(0);
  const [smsLogs, setSmsLogs] = useState<{ id: string; phone: string; message: string; status: string; created_at: string }[]>([]);
  const [showSmsLog, setShowSmsLog] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [allMembers, setAllMembers] = useState<MemberWithBrand[]>([]);

  // Fetch SMS123 balance
  function refreshSmsBalance() {
    setSmsBalanceLoading(true);
    fetch("/api/sms/credits?brand_id=brand-celsius")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setSmsBalance(data.balance);
          setSmsSentThisMonth(data.sent_this_month);
        }
      })
      .catch(() => {})
      .finally(() => setSmsBalanceLoading(false));
  }

  // Load SMS data
  useEffect(() => {
    refreshSmsBalance();
    fetch("/api/sms/logs?brand_id=brand-celsius&limit=100")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setSmsLogs(data); })
      .catch(() => {});
    fetchMembers("brand-celsius", { all: true }).then(setAllMembers);
  }, []);

  // Get target phones based on audience
  function getTargetPhones(): string[] {
    return allMembers
      .filter((m) => {
        // PDPA: Exclude members who opted out of SMS marketing
        if (m.sms_opt_out === true) return false;
        if (formAudience === "all") return true;
        if (formAudience === "new") return (m.brand_data?.total_visits ?? 0) <= 1;
        if (formAudience === "returning") return (m.brand_data?.total_visits ?? 0) >= 3;
        if (formAudience === "inactive") {
          const lastVisit = m.brand_data?.last_visit_at;
          if (!lastVisit) return true;
          return Date.now() - new Date(lastVisit).getTime() > 30 * 86400000;
        }
        if (formAudience === "eligible") {
          return (m.brand_data?.points_balance ?? 0) >= 300;
        }
        if (formAudience === "custom") {
          for (const f of customFilters) {
            if (!f.value) continue;
            const num = parseFloat(f.value);
            if (f.field === "points_balance") {
              const val = m.brand_data?.points_balance ?? 0;
              if (f.op === ">" && !(val > num)) return false;
              if (f.op === "<" && !(val < num)) return false;
              if (f.op === "=" && !(val === num)) return false;
            }
            if (f.field === "total_visits") {
              const val = m.brand_data?.total_visits ?? 0;
              if (f.op === ">" && !(val > num)) return false;
              if (f.op === "<" && !(val < num)) return false;
              if (f.op === "=" && !(val === num)) return false;
            }
            if (f.field === "total_spend") {
              const val = m.brand_data?.total_spent ?? 0;
              if (f.op === ">" && !(val > num)) return false;
              if (f.op === "<" && !(val < num)) return false;
              if (f.op === "=" && !(val === num)) return false;
            }
            if (f.field === "last_visit") {
              const lastVisit = m.brand_data?.last_visit_at ? new Date(m.brand_data.last_visit_at).getTime() : 0;
              const target = new Date(f.value).getTime();
              if (f.op === ">" && !(lastVisit > target)) return false;
              if (f.op === "<" && !(lastVisit < target)) return false;
              if (f.op === "within") {
                const days = parseInt(f.value);
                if (!(lastVisit > Date.now() - days * 86400000)) return false;
              }
            }
            if (f.field === "joined_date") {
              const joined = m.brand_data?.joined_at ? new Date(m.brand_data.joined_at).getTime() : new Date(m.created_at).getTime();
              const target = new Date(f.value).getTime();
              if (f.op === ">" && !(joined > target)) return false;
              if (f.op === "<" && !(joined < target)) return false;
            }
          }
          return true;
        }
        return true;
      })
      .map((m) => m.phone);
  }

  const smsOptOutCount = allMembers.filter((m) => m.sms_opt_out === true).length;

  // Send SMS blast
  async function handleSmsSend() {
    const phones = getTargetPhones();
    if (phones.length === 0) {
      alert("No members match the selected audience.");
      return;
    }
    if (!formMessage.trim()) {
      alert("Please enter a message.");
      return;
    }
    if (smsBalance !== null && smsBalance < phones.length) {
      alert(`Insufficient SMS123 credits (${Math.floor(smsBalance)} left, need ${phones.length}). Please top up at sms123.net.`);
      return;
    }
    if (!confirm(`Send SMS to ${phones.length} members?`)) {
      return;
    }

    setSmsSending(true);
    try {
      const res = await fetch("/api/sms/blast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: "brand-celsius",
          phones,
          message: fullMessage,
          sender_id: formSenderId || undefined,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setSmsSentThisMonth((prev) => prev + result.sent);
        refreshSmsBalance();
        // Add to messages list
        const newMsg: NotificationMessage = {
          id: `msg-${Date.now()}`,
          message: formMessage.trim(),
          channel: formChannel as Channel,
          audience: audienceOptions.find((o) => o.value === formAudience)?.label ?? formAudience,
          sent: result.sent,
          delivered: result.sent - result.failed,
          status: "sent",
        };
        setMessages((prev) => [newMsg, ...prev]);
        alert(`SMS sent! ${result.sent} delivered, ${result.failed} failed.`);
        // Refresh logs
        fetch("/api/sms/logs?brand_id=brand-celsius&limit=100")
          .then((r) => r.ok ? r.json() : null)
          .then((data) => { if (data) setSmsLogs(data); })
          .catch(() => {});
        setShowComposeModal(false);
        resetForm();
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch {
      alert("Failed to send SMS. Please try again.");
    }
    setSmsSending(false);
  }


  const insertVariable = (variable: string) => {
    setFormMessage((prev) => prev + variable);
  };

  // Build preview text by replacing variables with sample data
  // No header needed here — the blast API auto-prepends "RM0 [CelsiusCoffee] "
  const fullMessage = formMessage;

  const previewText = useMemo(() => {
    if (!fullMessage) return "Your message preview will appear here...";
    // Show the actual message that will be sent (with RM0 prefix the API adds)
    const SMS_PREFIX = "RM0 [CelsiusCoffee] ";
    let text = fullMessage.startsWith(SMS_PREFIX) ? fullMessage : `${SMS_PREFIX}${fullMessage}`;
    variables.forEach((v) => {
      text = text.replaceAll(v.key, v.preview);
    });
    return text;
  }, [fullMessage]);

  // KPI data
  const totalSent = messages.reduce((acc, m) => acc + (m.sent ?? 0), 0);
  const totalDelivered = messages.reduce(
    (acc, m) => acc + (m.delivered ?? 0),
    0
  );
  const deliveryRate =
    totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {/* SMS123 Balance */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
              <CreditCard className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">SMS credits</p>
              <div className="flex items-center gap-2">
                <p className={`font-sans text-xl font-bold ${smsBalance !== null && smsBalance < 100 ? "text-red-500" : "text-gray-900 dark:text-white"}`}>
                  {smsBalance !== null ? Math.floor(smsBalance).toLocaleString() : "—"}
                </p>
                <button onClick={refreshSmsBalance} disabled={smsBalanceLoading} className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300" title="Refresh balance">
                  <RefreshCw className={`h-3.5 w-3.5 ${smsBalanceLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <a href="https://www.sms123.net" target="_blank" rel="noopener noreferrer" className="text-[10px] font-medium text-[#C2452D] hover:underline inline-flex items-center gap-0.5">
                Top up on SMS123 <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Sent this month */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <Send className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">Sent this month</p>
              <p className="font-sans text-xl font-bold text-gray-900 dark:text-white">
                {smsSentThisMonth.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Delivery rate */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
              <MessageSquare className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">Delivery rate</p>
              <p className="font-sans text-xl font-bold text-gray-900 dark:text-white">
                {deliveryRate}%
              </p>
            </div>
          </div>
        </div>

        {/* Members reachable */}
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50">
              <Users className="h-5 w-5 text-[#C2452D]" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">Members reachable</p>
              <p className="font-sans text-xl font-bold text-gray-900 dark:text-white">
                {allMembers.length.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>


      {/* ── SMS Log Panel ── */}
      {showSmsLog && (
        <div className="rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-neutral-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <History className="h-4 w-4 text-gray-400" />
              SMS Send Log
            </h3>
            <button onClick={() => setShowSmsLog(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-neutral-800">
                <tr className="text-xs text-gray-500 dark:text-neutral-400 uppercase">
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Phone</th>
                  <th className="px-4 py-2 text-left">Message</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-neutral-700/50">
                {smsLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400 dark:text-neutral-500">
                      No SMS sent yet
                    </td>
                  </tr>
                ) : smsLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 dark:hover:bg-neutral-700/30">
                    <td className="px-4 py-2 whitespace-nowrap font-sans text-gray-500 dark:text-neutral-400">
                      {new Date(log.created_at).toLocaleString("en-MY", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2 font-sans text-gray-700 dark:text-neutral-300">{formatPhone(log.phone)}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-neutral-400 max-w-xs truncate">{log.message}</td>
                    <td className="px-4 py-2">
                      <span className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        log.status === "sent" || log.status === "delivered" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                      )}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Status Tabs + Actions ─────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const count =
              tab.key === "all"
                ? messages.length
                : messages.filter((m) => m.status === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
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
                placeholder="Search messages..."
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
              const rows = filtered.map((m) => ({
                message: m.message,
                channel: channelBadge[m.channel].label,
                audience: m.audience,
                sent: m.sent ?? "",
                delivered: m.delivered ?? "",
                status: statusBadge[m.status].label,
              }));
              exportToCSV(rows, [
                { key: "message", label: "Message" },
                { key: "channel", label: "Channel" },
                { key: "audience", label: "Audience" },
                { key: "sent", label: "Sent Count" },
                { key: "delivered", label: "Delivered Count" },
                { key: "status", label: "Status" },
              ], `celsius-notifications-${today}`);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
            title="Export CSV"
          >
            <Download className="h-4 w-4" />
          </button>

          {/* View log */}
          <button
            onClick={() => setShowSmsLog(!showSmsLog)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors",
              showSmsLog
                ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                : "border-gray-200 dark:border-neutral-700 text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
            )}
          >
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Log</span>
          </button>

          {/* Create new */}
          <button
            onClick={() => setShowComposeModal(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#C2452D] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822]"
          >
            <Plus className="h-4 w-4" />
            Compose
          </button>
        </div>
      </div>

      {/* ── Message Table ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-700 bg-gray-50/60 dark:bg-neutral-800">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Message
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Channel
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Audience
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Sent
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Delivered
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-neutral-400" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-700/50">
              {filtered.map((msg) => {
                const sBadge = statusBadge[msg.status];
                const cBadge = channelBadge[msg.channel];
                const ChannelIcon = cBadge.icon;
                return (
                  <tr
                    key={msg.id}
                    className="transition-colors hover:bg-gray-50/50 dark:hover:bg-neutral-700/50"
                  >
                    {/* Message */}
                    <td className="max-w-[260px] px-4 py-3">
                      <p className="truncate font-medium text-gray-900 dark:text-white">
                        {msg.message}
                      </p>
                      {msg.scheduledAt && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                          <Clock className="h-3 w-3" />
                          {new Date(msg.scheduledAt).toLocaleDateString(
                            "en-MY",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </p>
                      )}
                    </td>
                    {/* Channel */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          cBadge.bg,
                          cBadge.text
                        )}
                      >
                        <ChannelIcon className="h-3 w-3" />
                        {cBadge.label}
                      </span>
                    </td>
                    {/* Audience */}
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-neutral-400">
                      {msg.audience}
                    </td>
                    {/* Sent */}
                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-neutral-300">
                      {msg.sent !== null ? msg.sent.toLocaleString() : "\u2014"}
                    </td>
                    {/* Delivered */}
                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-neutral-300">
                      {msg.delivered !== null
                        ? msg.delivered.toLocaleString()
                        : "\u2014"}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          sBadge.bg,
                          sBadge.text
                        )}
                      >
                        {sBadge.label}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openMenu === msg.id) {
                              setOpenMenu(null);
                              setMenuPos(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const spaceBelow = window.innerHeight - rect.bottom;
                              setMenuPos(spaceBelow < 140
                                ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right }
                                : { top: rect.bottom + 4, right: window.innerWidth - rect.right }
                              );
                              setOpenMenu(msg.id);
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
                    No messages found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Compose Modal ──────────────────────────────────────── */}
      {/* ─── Fixed-position action dropdown (escapes overflow-hidden clipping) ─── */}
      {openMenu && menuPos && !deleteConfirm && (
        <div
          data-engage-menu
          style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, zIndex: 50 }}
          className="w-40 overflow-hidden rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const msg = messages.find((m) => m.id === openMenu);
              if (msg) setViewingMsg(msg);
              setOpenMenu(null);
              setMenuPos(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Eye className="h-3.5 w-3.5" />
            View Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const msg = messages.find((m) => m.id === openMenu);
              if (msg) {
                setEditingMsg(msg);
                setFormChannel(msg.channel);
                // Reverse-lookup audience value from label
                const matchedOpt = audienceOptions.find((o) => o.label === msg.audience);
                setFormAudience(matchedOpt?.value || "all");
                setFormMessage(msg.message);
                if (msg.status === "scheduled" && msg.scheduledAt) {
                  setFormScheduleType("later");
                  const d = new Date(msg.scheduledAt);
                  setFormScheduleDate(d.toISOString().split("T")[0]);
                  setFormScheduleTime(d.toTimeString().slice(0, 5));
                } else {
                  setFormScheduleType("now");
                }
                setShowComposeModal(true);
              }
              setOpenMenu(null);
              setMenuPos(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm(openMenu);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {deleteConfirm && menuPos && (
        <div
          data-engage-menu
          style={{ position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, zIndex: 50 }}
          className="w-56 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-neutral-800 shadow-lg p-3"
        >
          <p className="text-sm text-gray-700 dark:text-neutral-300 mb-2">Delete this message?</p>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); setOpenMenu(null); setMenuPos(null); }}
              className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const idToDelete = deleteConfirm;
                setMessages((prev) => prev.filter((m) => m.id !== idToDelete));
                const deleted = JSON.parse(sessionStorage.getItem("engage_deleted") || "[]");
                deleted.push(idToDelete);
                sessionStorage.setItem("engage_deleted", JSON.stringify(deleted));
                setDeleteConfirm(null);
                setOpenMenu(null);
                setMenuPos(null);
              }}
              className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* ── View Details Modal ────────────────────────────────── */}
      {viewingMsg && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-10 pb-10"
          onClick={() => setViewingMsg(null)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewingMsg(null)}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">
              Message Details
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Channel</span>
                <span className="font-medium text-gray-900 dark:text-white capitalize">{viewingMsg.channel}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Audience</span>
                <span className="font-medium text-gray-900 dark:text-white">{viewingMsg.audience}</span>
              </div>
              <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400">Status</span>
                <span className="font-medium text-gray-900 dark:text-white capitalize">{viewingMsg.status}</span>
              </div>
              {viewingMsg.sent !== null && (
                <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400">Sent / Delivered</span>
                  <span className="font-medium text-gray-900 dark:text-white">{viewingMsg.sent?.toLocaleString()} / {(viewingMsg.delivered ?? 0).toLocaleString()}</span>
                </div>
              )}
              {viewingMsg.scheduledAt && (
                <div className="flex justify-between border-b border-gray-100 dark:border-neutral-700 pb-2">
                  <span className="text-gray-500 dark:text-neutral-400">Scheduled</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {new Date(viewingMsg.scheduledAt).toLocaleString("en-MY")}
                  </span>
                </div>
              )}
              <div className="border-b border-gray-100 dark:border-neutral-700 pb-2">
                <span className="text-gray-500 dark:text-neutral-400 block mb-1">Message</span>
                <p className="rounded-lg bg-gray-50 dark:bg-neutral-700 p-3 text-gray-900 dark:text-white whitespace-pre-wrap">{viewingMsg.message}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  const msg = viewingMsg;
                  setViewingMsg(null);
                  setEditingMsg(msg);
                  setFormChannel(msg.channel);
                  const matchedOpt = audienceOptions.find((o) => o.label === msg.audience);
                  setFormAudience(matchedOpt?.value || "all");
                  setFormMessage(msg.message);
                  if (msg.status === "scheduled" && msg.scheduledAt) {
                    setFormScheduleType("later");
                    const d = new Date(msg.scheduledAt);
                    setFormScheduleDate(d.toISOString().split("T")[0]);
                    setFormScheduleTime(d.toTimeString().slice(0, 5));
                  } else {
                    setFormScheduleType("now");
                  }
                  setShowComposeModal(true);
                }}
                className="flex-1 rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white hover:bg-[#A93B26]"
              >
                Edit Message
              </button>
              <button
                onClick={() => setViewingMsg(null)}
                className="flex-1 rounded-lg bg-gray-100 dark:bg-neutral-700 px-4 py-2 text-sm font-medium text-gray-600 dark:text-neutral-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showComposeModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 pt-6 pb-10">
          <div className="relative w-full max-w-4xl rounded-2xl bg-white dark:bg-neutral-800 p-6 shadow-xl">
            {/* Close */}
            <button
              onClick={() => {
                setShowComposeModal(false);
                resetForm();
              }}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-700 hover:text-gray-600 dark:hover:text-neutral-300"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-5 text-lg font-bold text-gray-900 dark:text-white">
              {editingMsg ? "Edit message" : "Compose message"}
            </h2>

            <div className="flex gap-6">
              {/* ─── Left: Form ─── */}
              <div className="flex-1 space-y-4">
                {/* Channel */}
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

                {/* Sender ID */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Sender ID (Header)
                  </label>
                  <input
                    type="text"
                    value={formSenderId}
                    onChange={(e) => setFormSenderId(e.target.value.slice(0, 15))}
                    placeholder="e.g. CelsiusCoffee"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Name shown as SMS sender. Must be registered with SMS123.
                  </p>
                </div>

                {/* Audience */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Audience
                  </label>
                  <div className="relative">
                    <select
                      value={formAudience}
                      onChange={(e) => {
                        setFormAudience(e.target.value);
                        const tpl = smsTemplates[e.target.value];
                        if (tpl && !formMessage.trim()) setFormMessage(tpl);
                      }}
                      className="w-full appearance-none rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    >
                      {audienceOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>

                {/* Custom filter builder */}
                {formAudience === "custom" && (
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
                              updateFilter(idx, "field", e.target.value)
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

                {/* Message */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-neutral-300">
                      Message
                    </label>
                    {smsTemplates[formAudience] && (
                      <button
                        onClick={() => setFormMessage(smsTemplates[formAudience])}
                        className="text-xs font-medium text-[#C2452D] hover:underline"
                      >
                        Use template
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <textarea
                      value={formMessage}
                      onChange={(e) => {
                        if (e.target.value.length <= charLimit) {
                          setFormMessage(e.target.value);
                        }
                      }}
                      placeholder="Type your SMS message..."
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <span
                        className={cn(
                          "text-xs",
                          fullMessage.length > charLimit * 0.9
                            ? "text-red-500"
                            : "text-gray-400"
                        )}
                      >
                        {fullMessage.length}/{charLimit} characters
                        <span className="text-gray-300"> (auto-prefix: RM0 [CelsiusCoffee])</span>
                      </span>
                      {(formChannel === "sms" || formChannel === "both") && formScheduleType === "now" && smsBalance !== null && (
                        <span className="text-xs text-gray-400">
                          Credits: <span className={smsBalance < getTargetPhones().length ? "text-red-500 font-medium" : "text-green-600 font-medium"}>{Math.floor(smsBalance).toLocaleString()}</span> / {getTargetPhones().length.toLocaleString()} needed
                        </span>
                      )}
                    </div>
                    {(formChannel === "sms" || formChannel === "both") && formScheduleType === "now" && smsBalance !== null && smsBalance < getTargetPhones().length && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Insufficient SMS123 balance. <a href="https://www.sms123.net" target="_blank" rel="noopener noreferrer" className="underline font-medium">Top up on SMS123</a>
                        </p>
                      </div>
                    )}
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

                {/* Schedule */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-neutral-300">
                    Schedule
                  </label>
                  <div className="flex items-center gap-3">
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        formScheduleType === "now"
                          ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                          : "border-gray-200 dark:border-neutral-600 text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
                      )}
                    >
                      <input
                        type="radio"
                        name="schedule"
                        value="now"
                        checked={formScheduleType === "now"}
                        onChange={() => setFormScheduleType("now")}
                        className="sr-only"
                      />
                      <Send className="h-4 w-4" />
                      Send now
                    </label>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        formScheduleType === "later"
                          ? "border-[#C2452D] bg-[#C2452D]/5 text-[#C2452D]"
                          : "border-gray-200 dark:border-neutral-600 text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
                      )}
                    >
                      <input
                        type="radio"
                        name="schedule"
                        value="later"
                        checked={formScheduleType === "later"}
                        onChange={() => setFormScheduleType("later")}
                        className="sr-only"
                      />
                      <Calendar className="h-4 w-4" />
                      Schedule
                    </label>
                  </div>

                  {formScheduleType === "later" && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Calendar className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="date"
                          value={formScheduleDate}
                          onChange={(e) => setFormScheduleDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                      <div className="relative flex-1">
                        <Clock className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="time"
                          value={formScheduleTime}
                          onChange={(e) => setFormScheduleTime(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-[#C2452D] focus:outline-none focus:ring-1 focus:ring-[#C2452D]"
                        />
                      </div>
                    </div>
                  )}

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
                        {formSenderId || "SMS"}
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
                  setShowComposeModal(false);
                  resetForm();
                }}
                className="rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700"
              >
                Cancel
              </button>
              {!editingMsg && (
                <button
                  onClick={() => {
                    if (!formMessage.trim()) return;
                    const newMsg: NotificationMessage = {
                      id: `msg-${Date.now()}`,
                      message: formMessage.trim(),
                      channel: formChannel,
                      audience: audienceOptions.find((o) => o.value === formAudience)?.label ?? formAudience,
                      sent: null,
                      delivered: null,
                      status: "draft",
                    };
                    setMessages((prev) => [newMsg, ...prev]);
                    setShowComposeModal(false);
                    resetForm();
                  }}
                  disabled={!formMessage.trim()}
                  className="rounded-lg border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save as draft
                </button>
              )}
              <button
                onClick={() => {
                  if (!formMessage.trim()) return;
                  if (formScheduleType === "now" && !editingMsg && (formChannel === "sms" || formChannel === "both")) {
                    // Actually send SMS via API
                    handleSmsSend();
                    return;
                  }
                  const status: MessageStatus = formScheduleType === "later" ? "scheduled" : "sent";
                  const scheduledAt = formScheduleType === "later" && formScheduleDate && formScheduleTime
                    ? new Date(`${formScheduleDate}T${formScheduleTime}`).toISOString()
                    : undefined;
                  if (editingMsg) {
                    const editId = editingMsg.id;
                    const updatedAudience = audienceOptions.find((o) => o.value === formAudience)?.label || formAudience;
                    const updatedChannel = formChannel;
                    const updatedMessage = formMessage.trim();
                    setMessages((prev) => prev.map((m) =>
                      m.id === editId
                        ? { ...m, message: updatedMessage, channel: updatedChannel, audience: updatedAudience, status, scheduledAt }
                        : m
                    ));
                  } else {
                    const newMsg: NotificationMessage = {
                      id: `msg-${Date.now()}`,
                      message: formMessage.trim(),
                      channel: formChannel,
                      audience: audienceOptions.find((o) => o.value === formAudience)?.label || formAudience,
                      sent: status === "sent" ? 0 : null,
                      delivered: status === "sent" ? 0 : null,
                      status,
                      scheduledAt,
                    };
                    setMessages((prev) => [newMsg, ...prev]);
                  }
                  setShowComposeModal(false);
                  resetForm();
                }}
                disabled={!formMessage.trim() || smsSending}
                className="rounded-lg bg-[#C2452D] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#A33822] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {smsSending ? "Sending..." : editingMsg ? "Save changes" : formScheduleType === "now" ? (
                  <><Send className="h-3.5 w-3.5" /> Send now ({getTargetPhones().length} members)</>
                ) : "Schedule"}
              </button>
              {smsOptOutCount > 0 && (
                <p className="text-[10px] text-gray-400 mt-1">{smsOptOutCount} opted-out member{smsOptOutCount > 1 ? "s" : ""} excluded (PDPA)</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
