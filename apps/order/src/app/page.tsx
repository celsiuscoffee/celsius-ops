import Image from "next/image";
import Link from "next/link";
import { Home, Gift, ClipboardList, User, ChevronDown, MapPin, Plus, ChevronRight } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "./_GlobalCartPill";
import { MemberBeansCard } from "./_MemberBeansCard";

/**
 * Customer home (Next.js Server Component) — replaces the pickup-native
 * SPA at `/`.
 *
 * Why this exists: the SPA renders through react-native-web's wrapper
 * chain (GestureHandlerRootView → SafeAreaProvider → Stack → page View
 * → ScrollView), each level clamping the document at viewport height
 * so iOS Safari never sees scroll on the body and never collapses its
 * URL bar. Four attempts to defeat that chain via CSS / JS broke
 * either scroll or layouts and were reverted. Rendering the home as
 * plain HTML here sidesteps the whole problem: body scrolls natively,
 * URL bar collapses, customers get back ~120px of viewport.
 *
 * Native iOS/Android pickup app is untouched — it never hits this
 * Next.js route, it runs the RN bundle directly.
 *
 * Inner routes (/menu, /cart, /product/[id], /order/[id], /rewards,
 * /orders, /account, /store) still rewrite to the SPA's index.html
 * via the middleware. Customers tap a BottomNav tab here and drop
 * into the SPA for those screens. URL bar may re-expand on those
 * routes — to be fixed by rebuilding them in Next.js next.
 */

// Re-render the home content at most once a minute. Posters change
// rarely; product list a bit more often. 60s revalidate keeps the
// page near-instant on subsequent visits without pinning a stale
// menu for hours after a backoffice edit.
export const revalidate = 60;

type HomePoster = {
  id: string;
  image_url: string;
  title: string | null;
  deeplink: string | null;
};

async function fetchPosters(): Promise<HomePoster[]> {
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, starts_at, ends_at, sort_order")
      .eq("brand_id", "brand-celsius")
      .eq("active", true)
      .eq("placement", "home")
      .order("sort_order", { ascending: true, nullsFirst: false });
    if (!data) return [];
    return data
      .filter((p) => {
        if (p.starts_at && new Date(p.starts_at).toISOString() > now) return false;
        if (p.ends_at && new Date(p.ends_at).toISOString() < now) return false;
        return true;
      })
      .map((p) => ({ id: p.id, image_url: p.image_url, title: p.title, deeplink: p.deeplink }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [posters, menu] = await Promise.all([fetchPosters(), getMenuData()]);
  const hero = posters[0] ?? null;
  const bestSellers = menu.products
    .filter((p) => p.isPopular && p.isAvailable)
    .sort((a, b) => (a.featuredPosition ?? 9999) - (b.featuredPosition ?? 9999))
    .slice(0, 4);

  return (
    <main className="bg-white text-[#160800] pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      {/* Hero — single poster, links to its deeplink (e.g. /menu?promo=…)
          if set. Falls back to /menu so the CTA always lands somewhere. */}
      <Link
        href={hero?.deeplink || "/menu"}
        className="relative block w-full aspect-[3/4] bg-[#160800]"
      >
        {hero ? (
          <Image
            src={hero.image_url}
            alt={hero.title ?? "Celsius Coffee"}
            fill
            priority
            sizes="(max-width: 430px) 100vw, 430px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-white/60 text-sm">
            Celsius Coffee
          </div>
        )}
        {/* Top bar overlaid on the hero — small logo + cart icon */}
        <div className="absolute top-3 left-4 right-4 flex items-center" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <Image
            src="/icons/icon-192.png"
            alt="Celsius"
            width={28}
            height={28}
            className="rounded-md"
          />
          <div className="flex-1" />
          <Link
            href="/cart"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90"
            aria-label="Cart"
          >
            <span className="text-[#160800]" style={{ fontWeight: 700 }}>
              {/* cart icon — use a simple svg to avoid layout shift */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </span>
          </Link>
        </div>
      </Link>

      {/* Member BEANS / REWARDS card — client component, hydrates from
          localStorage (the SPA's persisted Zustand store key). */}
      <div className="-mt-10 mx-4 relative z-10">
        <MemberBeansCard />
      </div>

      {/* Outlet picker → /store (still SPA for the picker flow) */}
      <Link
        href="/store"
        className="mt-4 mx-4 flex items-center gap-2 bg-[#F7F4F0] border border-[#E8E1D8] rounded-2xl px-4 py-3 active:opacity-70"
      >
        <MapPin size={14} className="text-[#A2492C]" />
        <span className="text-sm font-bold flex-1 truncate">Select outlet</span>
        <ChevronDown size={14} className="text-[#8E8E93]" />
      </Link>

      {/* Best Sellers */}
      {bestSellers.length > 0 && (
        <section className="mt-6 mx-4">
          <div className="flex items-center mb-3">
            <h2 className="text-lg font-bold flex-1" style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3 }}>
              Best Sellers
            </h2>
            <Link href="/menu" className="text-sm text-[#A2492C] flex items-center gap-1">
              More <ChevronRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {bestSellers.map((p) => (
              <Link
                key={p.id}
                href={`/product/${p.id}`}
                className="rounded-2xl bg-white border border-[#EBE5DE] overflow-hidden active:opacity-80"
              >
                <div className="relative w-full aspect-square bg-[#F2EDE5]">
                  {p.image ? (
                    <Image
                      src={p.image}
                      alt={p.name}
                      fill
                      sizes="(max-width: 430px) 50vw, 215px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold truncate">{p.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-sm text-[#A2492C] font-bold">
                      RM{p.basePrice.toFixed(2)}
                    </span>
                    <span className="h-7 w-7 rounded-full bg-[#160800] flex items-center justify-center">
                      <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* "Open the menu" CTA */}
      <div className="mt-6 mx-4">
        <Link
          href="/menu"
          className="block w-full rounded-full bg-[#A2492C] text-white text-center py-4 font-bold active:opacity-80"
        >
          Open the menu →
        </Link>
      </div>

      {/* Floating "View cart" pill (client component reads cart from
          localStorage and renders if non-empty). */}
      <GlobalCartPill />

      {/* BottomNav — fixed at viewport bottom. Plain <a> links to inner
          SPA routes; Home is the current page so it gets the active
          treatment. */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#EBE5DE] flex items-stretch z-20"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        <NavTab href="/" label="Home" Icon={Home} active />
        <NavTab href="/rewards" label="Rewards" Icon={Gift} />
        <NavMenuPuck href="/menu" />
        <NavTab href="/orders" label="Orders" Icon={ClipboardList} />
        <NavTab href="/account" label="Account" Icon={User} />
      </nav>
    </main>
  );
}

function NavTab({ href, label, Icon, active }: { href: string; label: string; Icon: typeof Home; active?: boolean }) {
  const color = active ? "#160800" : "#8E8E93";
  return (
    <Link
      href={href}
      className="flex-1 flex flex-col items-center justify-center gap-1 py-2 active:opacity-60"
    >
      <Icon size={24} color={color} strokeWidth={active ? 2.4 : 1.75} />
      <span className="text-[12.5px]" style={{ color, fontWeight: active ? 700 : 600, letterSpacing: 0.2 }}>
        {label}
      </span>
    </Link>
  );
}

// Menu tab: elevated terracotta-on-dark puck CTA in the centre, mirrors
// the SPA's BottomNav design.
function NavMenuPuck({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex-1 flex flex-col items-center active:opacity-80"
      aria-label="Menu"
    >
      <span
        className="-mt-4 flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: "#8E8E93",
          border: "3px solid #FFFFFF",
          boxShadow: "0 3px 8px rgba(0,0,0,0.2)",
        }}
      >
        {/* Celsius cup glyph — simple svg fallback */}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h12l-1 9a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z" />
          <path d="M9 21h6" />
          <path d="M12 17v4" />
        </svg>
      </span>
      <span className="text-[12.5px] mt-0.5" style={{ color: "#8E8E93", fontWeight: 600, letterSpacing: 0.2 }}>
        Menu
      </span>
    </Link>
  );
}
