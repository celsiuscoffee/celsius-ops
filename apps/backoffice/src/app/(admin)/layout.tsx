"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ShoppingBag,
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
  Check,
  Loader2,
  HandCoins,
  ClipboardCheck as ClipboardCheckIcon,
  CalendarClock,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  moduleKey?: string; // top-level module check
  items?: NavItem[];
  subgroups?: NavSubgroup[];
};

// ─── Sidebar Navigation Config ──────────────────────────────────────────

const ICON_SIZE = "h-4 w-4";

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Pickup App",
    icon: <ShoppingBag className={ICON_SIZE} />,
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
    subgroups: [
      {
        label: "Master Data",
        items: [
          { label: "Products", href: "/inventory/products", icon: <Package className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Suppliers", href: "/inventory/suppliers", icon: <Truck className={ICON_SIZE} />, moduleKey: "inventory:suppliers" },
          { label: "Categories", href: "/inventory/categories", icon: <Tags className={ICON_SIZE} />, moduleKey: "inventory:categories" },
          { label: "Menu & BOM", href: "/inventory/menus", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "inventory:menus" },
        ],
      },
      {
        label: "Ordering",
        items: [
          { label: "Purchase Orders", href: "/inventory/orders", icon: <FileText className={ICON_SIZE} />, moduleKey: "inventory:orders" },
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
          { label: "Transfers", href: "/inventory/transfers", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "inventory:transfers" },
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
    label: "Loyalty",
    icon: <Gift className={ICON_SIZE} />,
    items: [
      { label: "Dashboard", href: "/loyalty/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "loyalty:dashboard" },
      { label: "Members", href: "/loyalty/members", icon: <Heart className={ICON_SIZE} />, moduleKey: "loyalty:members" },
      { label: "Rewards", href: "/loyalty/rewards", icon: <Star className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
      { label: "Redemptions", href: "/loyalty/redemptions", icon: <TicketPercent className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
      { label: "Campaigns", href: "/loyalty/campaigns", icon: <Megaphone className={ICON_SIZE} />, moduleKey: "loyalty:campaigns" },
      { label: "Engage", href: "/loyalty/engage", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "loyalty:engage" },
      { label: "AI Insights", href: "/loyalty/insights", icon: <Sparkles className={ICON_SIZE} />, moduleKey: "loyalty:insights" },
    ],
  },
  {
    label: "Ops",
    icon: <ClipboardCheckIcon className={ICON_SIZE} />,
    items: [
      { label: "Performance", href: "/ops/performance", icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "ops:performance" },
      { label: "Audit", href: "/ops/audit", icon: <FileText className={ICON_SIZE} />, moduleKey: "ops:audit" },
      { label: "SOPs", href: "/ops/sops", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "ops:sops" },
      { label: "Categories", href: "/ops/categories", icon: <Tags className={ICON_SIZE} />, moduleKey: "ops:categories" },
    ],
  },
  {
    label: "Settings",
    icon: <SlidersHorizontal className={ICON_SIZE} />,
    items: [
      { label: "Outlets", href: "/settings/outlets", icon: <Building2 className={ICON_SIZE} />, moduleKey: "settings:outlets" },
      { label: "Staff & Access", href: "/settings/staff", icon: <UserCog className={ICON_SIZE} />, moduleKey: "settings:staff" },
      { label: "Approval Rules", href: "/settings/rules", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "settings:rules" },
      { label: "Integrations", href: "/settings/integrations", icon: <Plug className={ICON_SIZE} />, moduleKey: "settings:integrations" },
      { label: "System", href: "/settings/system", icon: <Wrench className={ICON_SIZE} />, moduleKey: "settings:system" },
    ],
  },
];

// ─── RBAC helper ────────────────────────────────────────────────────────

function canAccess(user: UserProfile | undefined, moduleKey?: string): boolean {
  if (!user) return false;
  // Admins and OWNER bypass all checks
  if (user.role === "ADMIN" || user.role === "OWNER") return true;
  if (!moduleKey) return true;
  if (!user.moduleAccess) return false;
  return user.moduleAccess.includes(moduleKey);
}

// ─── Accordion Section ──────────────────────────────────────────────────

function SidebarSection({
  section,
  user,
  expanded,
  onToggle,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  user: UserProfile | undefined;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
  onNavigate?: () => void;
}) {
  // Collect all hrefs for this section to determine if it has any visible items
  const allItems = section.items
    ? section.items.filter((item) => canAccess(user, item.moduleKey))
    : section.subgroups
      ? section.subgroups.flatMap((sg) => sg.items.filter((item) => canAccess(user, item.moduleKey)))
      : [];

  if (allItems.length === 0) return null;

  const isActive = allItems.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
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
          {section.items && section.items.filter((item) => canAccess(user, item.moduleKey)).map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
          {section.subgroups && section.subgroups.map((sg) => {
            const visibleItems = sg.items.filter((item) => canAccess(user, item.moduleKey));
            if (visibleItems.length === 0) return null;
            return (
              <div key={sg.label} className="mb-2">
                <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  {sg.label}
                </p>
                {visibleItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
        isActive
          ? "bg-terracotta/20 text-terracotta-light font-medium"
          : "text-white/50 hover:bg-white/5 hover:text-white/70"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
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
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[11px] text-white/50 hover:bg-white/5 hover:text-white/70 transition-colors cursor-pointer"
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

// ─── Sidebar Content ────────────────────────────────────────────────────

function SidebarContent({
  user,
  expandedSections,
  toggleSection,
  pathname,
  onNavigate,
  onLogout,
}: {
  user: UserProfile | undefined;
  expandedSections: Set<string>;
  toggleSection: (label: string) => void;
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-brand-dark">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <Image
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius"
          width={32}
          height={32}
          className="rounded-lg"
        />
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

      {/* Nav sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
        {NAV_SECTIONS.map((section) => (
          <SidebarSection
            key={section.label}
            section={section}
            user={user}
            expanded={expandedSections.has(section.label)}
            onToggle={() => toggleSection(section.label)}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* User footer */}
      {user && (
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
          <div className="mt-2">
            <PasswordChangeDialog hasPassword={user.hasPassword} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Layout ───────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const { data: user, isLoading } = useFetch<UserProfile>("/api/auth/me");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  // Auto-expand the section containing the current route
  useEffect(() => {
    for (const section of NAV_SECTIONS) {
      const allHrefs = section.items
        ? section.items.map((i) => i.href)
        : section.subgroups
          ? section.subgroups.flatMap((sg) => sg.items.map((i) => i.href))
          : [];

      if (allHrefs.some((href) => pathname === href || pathname.startsWith(href + "/"))) {
        setExpandedSections((prev) => {
          if (prev.has(section.label)) return prev;
          const next = new Set(prev);
          next.add(section.label);
          return next;
        });
        break;
      }
    }
  }, [pathname]);

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      if (prev.has(label)) {
        // Collapse if already open
        const next = new Set(prev);
        next.delete(label);
        return next;
      }
      // Accordion: close others, open this one
      return new Set([label]);
    });
  };

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
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block h-full overflow-hidden">
        <SidebarContent
          user={user}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          pathname={pathname}
          onLogout={handleLogout}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 h-full w-72">
            <SidebarContent
              user={user}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
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
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
