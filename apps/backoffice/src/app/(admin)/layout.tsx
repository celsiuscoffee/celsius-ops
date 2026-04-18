"use client";

import { useEffect, useState, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ShoppingBag,
  Box,
  Boxes,
  Gift,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  BarChart3,
  Users,
  Package,
  Truck,
  Tags,
  BookOpen,
  FileText,
  Receipt,
  ClipboardCheck,
  Trash2,
  ArrowLeftRight,
  TrendingUp,
  LineChart,
  Heart,
  Star,
  TicketPercent,
  Megaphone,
  MessageSquare,
  Sparkles,
  Building2,
  UserCog,
  ShieldCheck,
  Plug,
  Wrench,
  Lock,
  Eye,
  EyeOff,
  Scale,
  Check,
  Loader2,
  HandCoins,
  ClipboardCheck as ClipboardCheckIcon,
  CalendarClock,
  Brain,
  MessageCircle,
  Coins,
  Clock,
  CalendarDays,
  CalendarOff,
  Banknote,
  Bot,
  Sun,
  Moon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useTheme } from "@/components/theme-provider";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFetch } from "@/lib/use-fetch";

// ─── Types ──────────────────────────────────────────────────────────────

type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
  moduleAccess?: string[];
  hasPassword?: boolean;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  moduleKey?: string;
};

type NavSubgroup = {
  label: string;
  items: NavItem[];
};

type NavSection = {
  label: string;
  icon: React.ReactNode;
  railIcon: React.ReactNode; // larger icon for the rail
  moduleKey?: string; // top-level module check
  items?: NavItem[];
  subgroups?: NavSubgroup[];
  dividerBefore?: boolean; // visual divider in rail
};

// ─── Sidebar Navigation Config ──────────────────────────────────────────

const ICON_SIZE = "h-4 w-4";
const RAIL_ICON_SIZE = "h-5 w-5";

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Pickup App",
    icon: <ShoppingBag className={ICON_SIZE} />,
    railIcon: <ShoppingBag className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    items: [
      { label: "Orders", href: "/pickup/orders", icon: <ClipboardList className={ICON_SIZE} />, moduleKey: "pickup:orders" },
      { label: "Menu", href: "/pickup/menu", icon: <UtensilsCrossed className={ICON_SIZE} />, moduleKey: "pickup:menu" },
      { label: "Analytics", href: "/pickup/analytics", icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "pickup:analytics" },
      { label: "Customers", href: "/pickup/customers", icon: <Users className={ICON_SIZE} />, moduleKey: "pickup:customers" },
    ],
  },
  {
    label: "Inventory",
    icon: <Boxes className={ICON_SIZE} />,
    railIcon: <Boxes className={RAIL_ICON_SIZE} />,
    subgroups: [
      {
        label: "Master Data",
        items: [
          { label: "Ingredients", href: "/inventory/products", icon: <Package className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Perishables", href: "/inventory/perishables", icon: <Box className={ICON_SIZE} />, moduleKey: "inventory:perishables" },
          { label: "Suppliers", href: "/inventory/suppliers", icon: <Truck className={ICON_SIZE} />, moduleKey: "inventory:suppliers" },
          { label: "Groups & Storage", href: "/inventory/groups", icon: <Tags className={ICON_SIZE} />, moduleKey: "inventory:categories" },
          { label: "Menu & BOM", href: "/inventory/menus", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "inventory:menus" },
        ],
      },
      {
        label: "Ordering",
        items: [
          { label: "Purchase Orders", href: "/inventory/orders", icon: <FileText className={ICON_SIZE} />, moduleKey: "inventory:orders" },
          { label: "Transfers", href: "/inventory/transfers", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "inventory:transfers" },
          { label: "Receivings", href: "/inventory/receivings", icon: <Receipt className={ICON_SIZE} />, moduleKey: "inventory:receivings" },
          { label: "Invoices", href: "/inventory/invoices", icon: <ClipboardList className={ICON_SIZE} />, moduleKey: "inventory:invoices" },
          { label: "Pay & Claim", href: "/inventory/pay-and-claim", icon: <HandCoins className={ICON_SIZE} />, moduleKey: "inventory:pay-and-claim" },
        ],
      },
      {
        label: "Operations",
        items: [
          { label: "Stock Count", href: "/inventory/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "inventory:stock-count" },
          { label: "Wastage", href: "/inventory/wastage", icon: <Trash2 className={ICON_SIZE} />, moduleKey: "inventory:wastage" },
          { label: "Par Levels", href: "/inventory/par-levels", icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "inventory:par-levels" },
        ],
      },
      {
        label: "Analytics",
        items: [
          { label: "Reports", href: "/inventory/reports", icon: <LineChart className={ICON_SIZE} />, moduleKey: "inventory:reports" },
        ],
      },
    ],
  },
  {
    label: "Rewards",
    icon: <Gift className={ICON_SIZE} />,
    railIcon: <Gift className={RAIL_ICON_SIZE} />,
    items: [
      { label: "Dashboard", href: "/loyalty/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "loyalty:dashboard" },
      { label: "Members", href: "/loyalty/members", icon: <Heart className={ICON_SIZE} />, moduleKey: "loyalty:members" },
      { label: "Offers", href: "/loyalty/rewards", icon: <Star className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
      { label: "Points Log", href: "/loyalty/points-log", icon: <Coins className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
      { label: "Redemptions", href: "/loyalty/redemptions", icon: <TicketPercent className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
      { label: "Campaigns", href: "/loyalty/campaigns", icon: <Megaphone className={ICON_SIZE} />, moduleKey: "loyalty:campaigns" },
      { label: "Engage", href: "/loyalty/engage", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "loyalty:engage" },
      { label: "AI Insights", href: "/loyalty/insights", icon: <Sparkles className={ICON_SIZE} />, moduleKey: "loyalty:insights" },
    ],
  },
  {
    label: "Sales",
    icon: <BarChart3 className={ICON_SIZE} />,
    railIcon: <BarChart3 className={RAIL_ICON_SIZE} />,
    items: [
      { label: "Dashboard", href: "/sales/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "sales:dashboard" },
      { label: "Compare", href: "/sales/compare", icon: <Scale className={ICON_SIZE} />, moduleKey: "sales:dashboard" },
    ],
  },
  {
    label: "Reviews",
    icon: <MessageCircle className={ICON_SIZE} />,
    railIcon: <MessageCircle className={RAIL_ICON_SIZE} />,
    items: [
      { label: "All Reviews", href: "/reviews", icon: <Star className={ICON_SIZE} />, moduleKey: "reviews:list" },
      { label: "Settings", href: "/reviews/settings", icon: <SlidersHorizontal className={ICON_SIZE} />, moduleKey: "reviews:settings" },
    ],
  },
  {
    label: "Ops",
    icon: <ClipboardCheckIcon className={ICON_SIZE} />,
    railIcon: <ClipboardCheckIcon className={RAIL_ICON_SIZE} />,
    items: [
      { label: "Performance", href: "/ops/performance", icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "ops:performance" },
      { label: "Audits", href: "/ops/audit", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "ops:audit" },
      { label: "SOPs & Templates", href: "/ops/sops", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "ops:sops" },
      { label: "Categories", href: "/ops/categories", icon: <Tags className={ICON_SIZE} />, moduleKey: "ops:categories" },
    ],
  },
  {
    label: "HR",
    icon: <Bot className={ICON_SIZE} />,
    railIcon: <Bot className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    items: [
      { label: "Dashboard", href: "/hr", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "hr:dashboard" },
      { label: "Attendance", href: "/hr/attendance", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:attendance" },
      { label: "Schedules", href: "/hr/schedules", icon: <CalendarDays className={ICON_SIZE} />, moduleKey: "hr:schedules" },
      { label: "Leave", href: "/hr/leave", icon: <CalendarOff className={ICON_SIZE} />, moduleKey: "hr:leave" },
      { label: "Overtime", href: "/hr/overtime", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:overtime" },
      { label: "Payroll", href: "/hr/payroll", icon: <Banknote className={ICON_SIZE} />, moduleKey: "hr:payroll" },
      { label: "Employees", href: "/hr/employees", icon: <UserCog className={ICON_SIZE} />, moduleKey: "hr:employees" },
      { label: "Performance", href: "/hr/performance", icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "hr:performance" },
      { label: "Settings", href: "/hr/settings", icon: <SlidersHorizontal className={ICON_SIZE} />, moduleKey: "hr:settings" },
    ],
  },
  {
    label: "Settings",
    icon: <SlidersHorizontal className={ICON_SIZE} />,
    railIcon: <SlidersHorizontal className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    items: [
      { label: "Outlets", href: "/settings/outlets", icon: <Building2 className={ICON_SIZE} />, moduleKey: "settings:outlets" },
      { label: "Staff & Access", href: "/settings/staff", icon: <UserCog className={ICON_SIZE} />, moduleKey: "settings:staff" },
      { label: "Approval Rules", href: "/settings/rules", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "settings:rules" },
      { label: "Integrations", href: "/settings/integrations", icon: <Plug className={ICON_SIZE} />, moduleKey: "settings:integrations" },
      { label: "Stock Count", href: "/settings/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "settings:stock-count" },
      { label: "System", href: "/settings/system", icon: <Wrench className={ICON_SIZE} />, moduleKey: "settings:system" },
    ],
  },
];

// ─── RBAC helper ────────────────────────────────────────────────────────

function canAccess(user: UserProfile | undefined, moduleKey?: string): boolean {
  if (!user) return false;
  if (user.role === "ADMIN" || user.role === "OWNER") return true;
  if (!moduleKey) return true;
  if (!user.moduleAccess) return false;
  return user.moduleAccess.includes(moduleKey);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getSectionHrefs(section: NavSection): string[] {
  if (section.items) return section.items.map((i) => i.href);
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.map((i) => i.href));
  return [];
}

function getVisibleItems(section: NavSection, user: UserProfile | undefined): NavItem[] {
  if (section.items) return section.items.filter((item) => canAccess(user, item.moduleKey));
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.filter((item) => canAccess(user, item.moduleKey)));
  return [];
}

function pathMatchesSection(pathname: string, section: NavSection): boolean {
  return getSectionHrefs(section).some((href) => pathname === href || pathname.startsWith(href + "/"));
}

// ─── NavLink ────────────────────────────────────────────────────────────

function NavLink({
  item,
  pathname,
  onNavigate,
  siblingHrefs,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  siblingHrefs?: string[];
}) {
  const exact = pathname === item.href;
  const prefix = !exact && pathname.startsWith(item.href + "/");
  const siblingHasBetterMatch = prefix && siblingHrefs?.some(
    (h) => h !== item.href && h.length > item.href.length && (pathname === h || pathname.startsWith(h + "/"))
  );
  const isActive = exact || (prefix && !siblingHasBetterMatch);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
        isActive
          ? "bg-terracotta/10 text-terracotta font-medium"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

// ─── Icon Rail ──────────────────────────────────────────────────────────

function IconRail({
  user,
  activeModule,
  onModuleClick,
  pathname,
  onLogout,
}: {
  user: UserProfile;
  activeModule: string | null;
  onModuleClick: (label: string) => void;
  pathname: string;
  onLogout: () => void;
}) {
  const isDashboard = pathname === "/dashboard" || pathname === "/";

  return (
    <div className="flex h-full w-16 flex-col items-center bg-brand-dark py-3 gap-1">
      {/* Logo */}
      <div className="mb-3">
        <Image
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius"
          width={32}
          height={32}
          className="rounded-lg"
        />
      </div>

      {/* Dashboard */}
      <Link
        href="/dashboard"
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
          isDashboard ? "bg-terracotta text-white" : "text-white/50 hover:bg-white/10 hover:text-white/80"
        }`}
        title="Dashboard"
      >
        <LayoutDashboard className={RAIL_ICON_SIZE} />
      </Link>

      {/* Module icons */}
      <div className="mt-1 flex flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
        {NAV_SECTIONS.map((section) => {
          const visible = getVisibleItems(section, user);
          if (visible.length === 0) return null;

          const isActive = activeModule === section.label;
          const hasActiveRoute = pathMatchesSection(pathname, section);

          return (
            <div key={section.label} className="flex flex-col items-center">
              {section.dividerBefore && (
                <div className="my-1.5 h-px w-6 bg-white/10" />
              )}
              <button
                onClick={() => onModuleClick(section.label)}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                  isActive
                    ? "bg-terracotta text-white"
                    : hasActiveRoute
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:bg-white/10 hover:text-white/70"
                }`}
                title={section.label}
              >
                {section.railIcon}
                {/* Tooltip */}
                <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-neutral-900 px-2.5 py-1 text-xs text-white shadow-lg group-hover:block z-50">
                  {section.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="mt-2 flex flex-col items-center gap-2">
        <ThemeToggle />
        <button
          onClick={onLogout}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/30 hover:bg-white/10 hover:text-white/60 transition-colors"
          title="Logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
        <Avatar size="sm">
          <AvatarFallback className="bg-terracotta/30 text-terracotta-light text-xs">
            {user.name?.slice(0, 2).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

// ─── Theme Toggle ───────────────────────────────────────────────────────

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-white/30 hover:bg-white/10 hover:text-white/60 transition-colors"
      title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ─── Sub-nav Panel ──────────────────────────────────────────────────────

function SubNavPanel({
  section,
  user,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  user: UserProfile | undefined;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full w-56 flex-col border-r border-neutral-200 bg-white">
      {/* Module header */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-neutral-100">
        <span className="text-terracotta">{section.icon}</span>
        <h2 className="text-sm font-semibold text-neutral-900">{section.label}</h2>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        {section.items && (() => {
          const visible = section.items.filter((item) => canAccess(user, item.moduleKey));
          const hrefs = visible.map((i) => i.href);
          return (
            <div className="space-y-0.5">
              {visible.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} siblingHrefs={hrefs} />
              ))}
            </div>
          );
        })()}
        {section.subgroups && section.subgroups.map((sg) => {
          const visibleItems = sg.items.filter((item) => canAccess(user, item.moduleKey));
          if (visibleItems.length === 0) return null;
          const hrefs = visibleItems.map((i) => i.href);
          return (
            <div key={sg.label} className="mb-3">
              <p className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 first:mt-0">
                {sg.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} siblingHrefs={hrefs} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* User footer with password change */}
      {user && (
        <div className="border-t border-neutral-100 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar size="sm">
              <AvatarFallback className="bg-terracotta/10 text-terracotta text-xs">
                {user.name?.slice(0, 2).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-neutral-900">{user.name}</p>
              <p className="truncate text-[10px] text-neutral-400">{user.role}</p>
            </div>
          </div>
          <div className="mt-2">
            <PasswordChangeDialog hasPassword={user.hasPassword} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Password Change Dialog ─────────────────────────────────────────────

function PasswordChangeDialog({ hasPassword }: { hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const reset = () => {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setError("");
    setSuccess(false);
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleSave = async () => {
    setError("");
    if (newPw.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setError("Passwords do not match"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPw : undefined,
          newPassword: newPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save"); setSaving(false); return; }

      setSuccess(true);
      setTimeout(() => { setOpen(false); reset(); }, 1500);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors cursor-pointer"
      >
        <Lock className="h-3 w-3" />
        {hasPassword ? "Change Password" : "Set Password"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{hasPassword ? "Change Password" : "Set Password"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {hasPassword && (
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={showNew ? "text" : "password"}
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && (
            <p className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3 w-3" /> Password saved
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !newPw || !confirmPw}
            className="flex w-full items-center justify-center rounded-lg bg-terracotta py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Password"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mobile Sidebar (full list, for small screens) ─────────────────────

function MobileSidebar({
  user,
  pathname,
  onNavigate,
  onLogout,
}: {
  user: UserProfile;
  pathname: string;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const section of NAV_SECTIONS) {
      if (pathMatchesSection(pathname, section)) {
        initial.add(section.label);
        break;
      }
    }
    return initial;
  });

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      if (prev.has(label)) {
        const next = new Set(prev);
        next.delete(label);
        return next;
      }
      return new Set([label]);
    });
  };

  return (
    <div className="flex h-full flex-col bg-brand-dark">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <Image src="/images/celsius-logo-sm.jpg" alt="Celsius" width={32} height={32} className="rounded-lg" />
        <div>
          <h2 className="font-heading text-sm font-bold text-white">Celsius Ops</h2>
          <p className="text-[10px] text-white/40">Backoffice</p>
        </div>
      </div>

      {/* Home link */}
      <div className="px-3 pt-3 pb-1">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            pathname === "/dashboard" || pathname === "/" ? "bg-white/10 text-white font-medium" : "text-white/50 hover:bg-white/5 hover:text-white/70"
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Link>
      </div>

      {/* Nav sections (accordion) */}
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
        {NAV_SECTIONS.map((section) => {
          const visible = getVisibleItems(section, user);
          if (visible.length === 0) return null;

          const isActive = pathMatchesSection(pathname, section);
          const expanded = expandedSections.has(section.label);

          return (
            <div key={section.label} className="mb-1">
              <button
                onClick={() => toggleSection(section.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                {section.icon}
                <span className="flex-1 text-left">{section.label}</span>
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>

              {expanded && (
                <div className="mt-1 ml-3 border-l border-white/10 pl-3">
                  {section.items && (() => {
                    const vis = section.items.filter((item) => canAccess(user, item.moduleKey));
                    const hrefs = vis.map((i) => i.href);
                    return vis.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                          pathname === item.href || pathname.startsWith(item.href + "/")
                            ? "bg-terracotta/20 text-terracotta-light font-medium"
                            : "text-white/50 hover:bg-white/5 hover:text-white/70"
                        }`}
                      >
                        {item.icon}
                        {item.label}
                      </Link>
                    ));
                  })()}
                  {section.subgroups && section.subgroups.map((sg) => {
                    const visibleItems = sg.items.filter((item) => canAccess(user, item.moduleKey));
                    if (visibleItems.length === 0) return null;
                    return (
                      <div key={sg.label} className="mb-2">
                        <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                          {sg.label}
                        </p>
                        {visibleItems.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                              pathname === item.href || pathname.startsWith(item.href + "/")
                                ? "bg-terracotta/20 text-terracotta-light font-medium"
                                : "text-white/50 hover:bg-white/5 hover:text-white/70"
                            }`}
                          >
                            {item.icon}
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* User footer */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback className="bg-terracotta/20 text-terracotta-light text-xs">
              {user.name?.slice(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-white">{user.name}</p>
            <p className="truncate text-[10px] text-white/40">{user.role}</p>
          </div>
          <button
            onClick={onLogout}
            className="rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Layout ───────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>(null);

  const { data: user, isLoading } = useFetch<UserProfile>("/api/auth/me");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  // Block direct URL access to unauthorized pages
  useEffect(() => {
    if (!user || !pathname) return;
    // Dashboard is always accessible
    if (pathname === "/dashboard" || pathname === "/") return;
    // OWNER and ADMIN bypass all checks
    if (user.role === "ADMIN" || user.role === "OWNER") return;
    // Empty moduleAccess = full access (legacy behavior)
    if (!user.moduleAccess || user.moduleAccess.length === 0) return;

    // Find the moduleKey for the current path
    for (const section of NAV_SECTIONS) {
      const allItems = [
        ...(section.items ?? []),
        ...(section.subgroups?.flatMap((sg) => sg.items) ?? []),
      ];
      for (const item of allItems) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          if (item.moduleKey && !canAccess(user, item.moduleKey)) {
            router.replace("/dashboard");
            return;
          }
          return; // Found matching route, access OK
        }
      }
    }
  }, [user, pathname, router]);

  // Auto-select module based on current pathname
  useEffect(() => {
    const isDashboard = pathname === "/dashboard" || pathname === "/";
    if (isDashboard) {
      setActiveModule(null);
      return;
    }

    for (const section of NAV_SECTIONS) {
      if (pathMatchesSection(pathname, section)) {
        setActiveModule(section.label);
        return;
      }
    }
  }, [pathname]);

  const handleModuleClick = (label: string) => {
    if (activeModule === label) {
      // Clicking the same module again collapses the sub-nav
      setActiveModule(null);
    } else {
      setActiveModule(label);
    }
  };

  const activeSection = useMemo(
    () => NAV_SECTIONS.find((s) => s.label === activeModule) ?? null,
    [activeModule]
  );

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-offwhite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-terracotta border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-brand-offwhite">
      {/* Desktop: Icon Rail + Sub-nav */}
      <div className="hidden lg:flex h-full">
        <IconRail
          user={user}
          activeModule={activeModule}
          onModuleClick={handleModuleClick}
          pathname={pathname}
          onLogout={handleLogout}
        />
        {activeSection && (
          <SubNavPanel
            section={activeSection}
            user={user}
            pathname={pathname}
          />
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 h-full w-72">
            <MobileSidebar
              user={user}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex items-center gap-3 border-b border-border bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-muted">
            <Menu className="h-5 w-5" />
          </button>
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius" width={24} height={24} className="rounded-md" />
          <span className="font-heading text-sm font-bold">Celsius Ops</span>
        </header>

        {/* Page content */}
        <PullToRefresh
          onRefresh={async () => { window.location.reload(); }}
          className="flex-1 overflow-y-auto overflow-x-hidden"
        >
          {children}
        </PullToRefresh>
      </div>
    </div>
  );
}
