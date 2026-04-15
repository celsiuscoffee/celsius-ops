"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Gift,
  TicketCheck,
  Megaphone,
  MessageSquare,
  Settings,
  ChevronDown,
  Sun,
  Moon,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  UserCircle,
  KeyRound,
  Sparkles,
  Package,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import Image from "next/image";

/* Brand data — will connect to Supabase later */
const brands = [
  { id: "brand-celsius", name: "Celsius Coffee", primary_color: "#1a1a1a" },
];

const navItems = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Members", href: "/admin/members", icon: Users },
  { label: "Rewards", href: "/admin/rewards", icon: Gift },
  { label: "Points Log", href: "/admin/points-log", icon: Coins },
  { label: "Redemptions", href: "/admin/redemptions", icon: TicketCheck },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Campaigns", href: "/admin/campaigns", icon: Megaphone },
  { label: "Engage", href: "/admin/notifications", icon: MessageSquare },
  { label: "AI Insights", href: "/admin/insights", icon: Sparkles },
  { label: "Users", href: "/admin/users", icon: UserCircle },
  { label: "Staff", href: "/admin/staff", icon: KeyRound },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/* ─────────────────────────────────────────────
   Login Form (shown when not authenticated)
───────────────────────────────────────────── */
function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
    };
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const success = await login(email, password);
    if (!success) {
      setError("Invalid email or password");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
    setIsSubmitting(false);
  };

  return (
    <div
      className="flex h-[100dvh] overflow-hidden items-center justify-center bg-gray-50 dark:bg-neutral-950 px-4"
      style={{ minHeight: "calc(var(--vh, 1vh) * 100)" }}
    >
      <div
        className={cn(
          "w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 p-8 shadow-xl shadow-gray-200/50 dark:shadow-black/30 border border-gray-100 dark:border-neutral-700 transition-transform",
          shake && "animate-[shake_0.4s_ease-in-out]"
        )}
      >
        {/* Logo & Title */}
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius Coffee"
            width={64}
            height={64}
            className="h-16 w-16 rounded-2xl object-cover shadow-md ring-1 ring-gray-100 dark:ring-neutral-700 mb-4"
          />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">
            Celsius Coffee
          </h1>
          <p className="text-sm text-gray-400 dark:text-neutral-500 font-medium mt-0.5">
            Admin Dashboard
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5 ml-1"
            >
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-neutral-500" />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@celsius.coffee"
                className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold text-gray-600 dark:text-neutral-400 mb-1.5 ml-1"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-neutral-500" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-700/50 pl-10 pr-10 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#C2452D]/40 focus:border-[#C2452D] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 font-medium text-center">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#C2452D] hover:bg-[#A93B26] disabled:opacity-60 text-white font-semibold py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Demo hint */}
        <p className="mt-6 text-center text-[11px] text-gray-400 dark:text-neutral-500">
          Login with your admin credentials
        </p>
      </div>

      {/* Shake keyframe (injected once) */}
      <style jsx global>{`
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-8px);
          }
          40% {
            transform: translateX(8px);
          }
          60% {
            transform: translateX(-6px);
          }
          80% {
            transform: translateX(6px);
          }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Loading Spinner
───────────────────────────────────────────── */
function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-neutral-950">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#C2452D]" />
        <p className="text-sm text-gray-400 dark:text-neutral-500 font-medium">
          Loading...
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Authenticated Sidebar Layout
───────────────────────────────────────────── */
function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { user, isLoading, logout } = useAuth();
  const [selectedBrand, setSelectedBrand] = useState(brands[0]);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setBrandDropdownOpen(false);
      }
      if (
        mobileNavRef.current &&
        !mobileNavRef.current.contains(e.target as Node)
      ) {
        setMobileNavOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Loading state
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Not authenticated: show login form
  if (!user) {
    return <LoginForm />;
  }

  // Authenticated: show sidebar layout
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-neutral-950">
      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 w-[240px] border-r border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        {/* Brand Selector */}
        <div className="px-4 py-5 border-b border-gray-100 dark:border-neutral-800" ref={dropdownRef}>
          <div className="relative">
            <button
              onClick={() => setBrandDropdownOpen(!brandDropdownOpen)}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-gray-50 dark:hover:bg-neutral-800 transition-all duration-200"
            >
              <Image
                src="/images/celsius-logo-sm.jpg"
                alt="Celsius Coffee"
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg object-cover shadow-sm ring-1 ring-gray-100 dark:ring-neutral-700"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {selectedBrand.name}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-neutral-500 font-medium">
                  Admin Panel
                </p>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-gray-400 dark:text-neutral-500 transition-transform duration-200",
                  brandDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {/* Dropdown */}
            {brandDropdownOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg shadow-gray-200/60 dark:shadow-black/40 overflow-hidden">
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    onClick={() => {
                      setSelectedBrand(brand);
                      setBrandDropdownOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors duration-150",
                      "hover:bg-gray-50 dark:hover:bg-neutral-700",
                      selectedBrand.id === brand.id
                        ? "bg-[#C2452D]/5 text-[#C2452D] font-medium"
                        : "text-gray-700 dark:text-neutral-300"
                    )}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: brand.primary_color }}
                    />
                    {brand.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 relative",
                  isActive
                    ? "bg-[#C2452D]/8 text-[#C2452D]"
                    : "text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {/* Active left border accent */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-[#C2452D]" />
                )}
                <item.icon
                  className={cn(
                    "h-[18px] w-[18px] flex-shrink-0 transition-colors duration-200",
                    isActive
                      ? "text-[#C2452D]"
                      : "text-gray-400 dark:text-neutral-500 group-hover:text-gray-600 dark:group-hover:text-neutral-300"
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-neutral-800 px-5 py-4">
          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            className="mb-3 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {theme === "light" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>

          {/* User info + sign out */}
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C2452D] text-white text-xs font-bold flex-shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 dark:text-neutral-200 truncate">
                {user.name}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-neutral-500 truncate">
                {user.email}
              </p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="text-gray-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex-1 md:pl-[240px] pb-24 md:pb-0 overflow-x-hidden">
        <div className="pt-[env(safe-area-inset-top)] md:pt-0">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
        </div>
      </main>

      {/* ─── Mobile Bottom Nav (dropdown) ─── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden pb-[env(safe-area-inset-bottom)]" ref={mobileNavRef}>
        {/* Dropdown menu (opens upward) */}
        {mobileNavOpen && (
          <div className="mx-3 mb-2 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-xl shadow-black/15 dark:shadow-black/40 overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
            <div className="grid grid-cols-3 gap-0.5 p-2">
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-[11px] font-medium transition-colors",
                      isActive
                        ? "bg-[#C2452D]/10 text-[#C2452D]"
                        : "text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              <button
                onClick={() => { setMobileNavOpen(false); logout(); }}
                className="flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-[11px] font-medium transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <LogOut className="h-5 w-5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

        {/* Bottom bar with current page button */}
        <nav className="border-t border-gray-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md">
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-2.5">
              {(() => {
                const current = navItems.find((item) => pathname.startsWith(item.href)) || navItems[0];
                const Icon = current.icon;
                return (
                  <>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C2452D]/10">
                      <Icon className="h-4 w-4 text-[#C2452D]" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {current.label}
                    </span>
                  </>
                );
              })()}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-gray-400 dark:text-neutral-500 transition-transform duration-200",
                mobileNavOpen && "rotate-180"
              )}
            />
          </button>
        </nav>
      </div>
    </div>
  );
}

export default function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </AuthProvider>
    </ThemeProvider>
  );
}
