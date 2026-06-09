import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import {
  Banknote, CreditCard, QrCode, Smartphone, Bike, ShoppingBag, Landmark, Wallet,
  Utensils, Package, Sunrise, Sunset, Sun, Moon, Coffee, Sandwich, UtensilsCrossed,
  TrendingUp, TrendingDown, UserPlus, BarChart3, ChevronDown,
} from "lucide-react-native";
import { useStaff } from "@/lib/store";
import { hasAccess } from "@/lib/access";
import { fetchSalesDashboard, type Mode, type SalesDashboard } from "@/lib/sales/dashboard";
import { AccumChart } from "@/components/sales/AccumChart";
import { RangeSheet } from "@/components/sales/RangeSheet";
import { OutletSheet } from "@/components/sales/OutletSheet";

const CREAM = "#F5F3F0";
const ESPRESSO = "#160800";
const CARD = "#26130699";
const ELEV = "#2a1508";

function mytToday(): string { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split("T")[0]; }
function addDays(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00+08:00`); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function rmF(n: number): string {
  const [i, d] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  return "RM " + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + d;
}
function numF(n: number): string { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function deltaStr(d: number | null): string { return d == null ? "New" : `${d >= 0 ? "+" : ""}${d}%`; }
function deltaUp(d: number | null): boolean { return d == null ? true : d >= 0; }
function rmDeltaStr(cur: number, prev: number): string {
  const d = cur - prev;
  return `${d >= 0 ? "+" : "−"}RM ${numF(Math.abs(d))}`;
}

const PAY_ICON: Record<string, any> = { cash: Banknote, card: CreditCard, duitnow_qr: QrCode, tng: Smartphone, grabpay: Bike, shopeepay: ShoppingBag, fpx: Landmark, wallet: Wallet };
const PAY_COLOR: Record<string, string> = { cash: "#34d399", card: "#8FB3F0", duitnow_qr: "#FBBF24", tng: "#a78bfa", grabpay: "#34d399", shopeepay: "#fb923c", fpx: "#60a5fa", wallet: "#a78bfa" };
const CHAN_ICON: Record<string, any> = { dine_in: Utensils, takeaway: ShoppingBag, pickup: Package, delivery: Bike };
const CHAN_COLOR: Record<string, string> = { dine_in: "#E0875F", takeaway: "#FBBF24", pickup: "#a78bfa", delivery: "#34d399" };
const ROUND_ICON: Record<string, any> = { breakfast: Sunrise, brunch: Coffee, lunch: Sandwich, midday: Sun, evening: Sunset, dinner: UtensilsCrossed, supper: Moon };

const TABS: { key: Mode; label: string }[] = [
  { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "custom", label: "Custom" },
];

export default function SalesScreen() {
  const session = useStaff((s) => s.session);
  const canView = hasAccess(session?.role, session?.moduleAccess, "sales");

  const [mode, setMode] = useState<Mode>("day");
  const [cTo, setCTo] = useState(mytToday());
  const [cFrom, setCFrom] = useState(addDays(mytToday(), -13));
  const [dim, setDim] = useState<"channel" | "round">("channel");
  const [sheet, setSheet] = useState(false);
  const isAdmin = session?.role === "OWNER" || session?.role === "ADMIN";
  const [outletId, setOutletId] = useState<string | undefined>(undefined);
  const selectedOutlet = isAdmin ? outletId ?? "all" : undefined;
  const [outletSheet, setOutletSheet] = useState(false);
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchSalesDashboard(mode, selectedOutlet, mode === "custom" ? cFrom : undefined, mode === "custom" ? cTo : undefined);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, cFrom, cTo, selectedOutlet]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!canView) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-[#160800] px-8">
        <BarChart3 color="#F5F3F066" size={34} />
        <Text className="mt-3 text-center font-body text-sm text-[#F5F3F08a]">You don&apos;t have access to Sales. Ask an admin to enable it.</Text>
      </SafeAreaView>
    );
  }

  const pressTab = (m: Mode) => { if (m === "custom") setSheet(true); else setMode(m); };
  const applyRange = (from: string, to: string) => { setCFrom(from); setCTo(to); setMode("custom"); setSheet(false); };

  const s = data?.summary;
  const g = data?.growth;
  const maxRound = data ? Math.max(1, ...data.rounds.map((r) => r.revenue)) : 1;

  return (
    <SafeAreaView className="flex-1 bg-[#160800]" edges={["top", "left", "right"]}>
      {/* Fixed header — pinned at top while the content below scrolls */}
      <View className="px-4 pt-3">
        <View className="flex-row items-center gap-3 pb-4">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#A2492C]">
            <Text className="font-display text-sm text-[#F5F3F0]">°C</Text>
          </View>
          <View className="flex-1">
            {isAdmin ? (
              <Pressable onPress={() => setOutletSheet(true)} hitSlop={8} className="flex-row items-center gap-1.5 self-start">
                <Text className="font-display text-2xl text-[#F5F3F0]">{data?.outletName ?? "Sales"}</Text>
                <ChevronDown color="#F5F3F08a" size={18} />
              </Pressable>
            ) : (
              <Text className="font-display text-2xl text-[#F5F3F0]">{data?.outletName ?? "Sales"}</Text>
            )}
            <Text className="font-body text-sm text-[#F5F3F08a]">Live · POS + Pickup</Text>
          </View>
        </View>

        {/* Period tabs */}
        <View className="mb-4 flex-row gap-1.5 rounded-2xl border border-[#F5F3F01a] bg-[#2a1508] p-1.5">
          {TABS.map((t) => {
            const on = mode === t.key;
            return (
              <Pressable key={t.key} onPress={() => pressTab(t.key)} className={`flex-1 items-center rounded-xl py-2.5 ${on ? "bg-[#A2492C]" : ""}`}>
                <Text className={`text-xs ${on ? "font-body-bold text-[#F5F3F0]" : "font-body-semi text-[#F5F3F08a]"}`}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerClassName="px-4 pb-16"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FBBF24" colors={["#FBBF24"]} progressBackgroundColor="#2a1508" />}
      >
        {loading && !data ? (
          <View className="items-center justify-center py-24"><ActivityIndicator color="#FBBF24" /></View>
        ) : error ? (
          <View className="rounded-2xl border border-[#F5F3F01a] bg-[#2a1508] p-5"><Text className="font-body text-sm text-[#f87171]">{error}</Text></View>
        ) : data && s && g ? (
          <View className="gap-3.5">
            {/* Hero */}
            <View className="rounded-3xl border border-[#F5F3F01a] bg-[#2a1508] p-5">
              <Text className="font-body text-xs text-[#F5F3F08a]">Net sales · {data.cur.label.toLowerCase()}</Text>
              <Text className="mt-1 font-display text-4xl text-[#F5F3F0]">{rmF(s.revenue)}</Text>
              <View className={`mt-2 flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${deltaUp(s.revenueDelta) ? "bg-[#34d39920]" : "bg-[#f8717120]"}`}>
                {deltaUp(s.revenueDelta) ? <TrendingUp color="#34d399" size={13} /> : <TrendingDown color="#f87171" size={13} />}
                <Text className={`font-body-bold text-xs ${deltaUp(s.revenueDelta) ? "text-[#34d399]" : "text-[#f87171]"}`}>{rmDeltaStr(s.revenue, s.prevRevenue)} · {deltaStr(s.revenueDelta)}</Text>
                <Text className="font-body text-xs text-[#F5F3F08a]"> vs {data.prev.label.toLowerCase()}</Text>
              </View>
              <View className="mt-4 flex-row gap-3 border-t border-[#F5F3F00f] pt-4">
                <Stat v={numF(s.orders)} k="Orders" />
                <Stat v={rmF(s.aov)} k="Avg order" />
                <Stat v={`${g.appSharePct}%`} k="Via app" />
              </View>
            </View>

            {/* Comparison chart */}
            <View className="rounded-3xl border border-[#F5F3F01a] bg-[#2a1508] p-5">
              <Text className="font-display text-sm text-[#F5F3F0]">Total Accumulative Sales <Text className="font-body text-[#F5F3F057]">(RM)</Text></Text>
              <Text className="mb-2 mt-0.5 font-body text-[11px] text-[#F5F3F08a]">{data.cur.label} vs {data.prev.label} · running total</Text>
              <AccumChart series={data.series} curLabel={data.cur.label} prevLabel={data.prev.label} />
              <View className="mt-3 flex-row justify-center gap-4">
                <Legend color="#FBBF24" label={data.cur.label} />
                <Legend color="#8FB3F0" label={data.prev.label} />
              </View>
            </View>

            {/* Growth */}
            <View className="rounded-3xl border border-[#F5F3F01a] bg-[#2a1508] p-5">
              <Text className="font-display text-sm text-[#F5F3F0]">Growth</Text>
              <Text className="mt-0.5 font-body text-[11px] text-[#F5F3F08a]">New this period</Text>
              <View className="mt-3 flex-row gap-3">
                <Tile icon={UserPlus} color="#34d399" v={numF(g.newCustomers)} k="New customers" delta={g.newCustomersDelta} />
                <Tile icon={Smartphone} color="#8FB3F0" v={numF(g.newAppCustomers)} k="New app customers" delta={g.newAppDelta} />
              </View>
              <View className="mt-3.5 flex-row items-center justify-between border-t border-[#F5F3F00f] pt-3.5">
                <Text className="font-body-semi text-xs text-[#F5F3F08a]">Orders via app · adoption</Text>
                <Text className="font-display text-sm text-[#F5F3F0]">{g.appSharePct}%<Text className="font-body-bold text-[11px] text-[#34d399]">  {g.appShareDeltaPts >= 0 ? "+" : ""}{g.appShareDeltaPts} pts</Text></Text>
              </View>
            </View>

            {/* Payment methods */}
            <View className="rounded-3xl border border-[#F5F3F01a] bg-[#2a1508] p-5">
              <Text className="font-display text-sm text-[#F5F3F0]">Payment methods</Text>
              <Text className="mb-1 mt-0.5 font-body text-[11px] text-[#F5F3F08a]">How customers paid</Text>
              {data.payments.length === 0 ? <Text className="py-3 font-body text-xs text-[#F5F3F057]">No payments in this period.</Text> :
                data.payments.map((p) => (
                  <Row key={p.key} icon={PAY_ICON[p.key] ?? Wallet} color={PAY_COLOR[p.key] ?? "#a78bfa"} name={p.label} pct={p.pct} amount={rmF(p.amount)} />
                ))}
            </View>

            {/* Channels / Dayparts */}
            <View className="rounded-3xl border border-[#F5F3F01a] bg-[#2a1508] p-5">
              <Text className="font-display text-sm text-[#F5F3F0]">Sales breakdown</Text>
              <View className="mb-1 mt-3 flex-row gap-1.5 rounded-xl border border-[#F5F3F01a] bg-[#160800] p-1">
                {(["channel", "round"] as const).map((d) => (
                  <Pressable key={d} onPress={() => setDim(d)} className={`flex-1 items-center rounded-lg py-2 ${dim === d ? "bg-[#A2492C40]" : ""}`}>
                    <Text className={`text-xs ${dim === d ? "font-body-bold text-[#F5F3F0]" : "font-body-semi text-[#F5F3F08a]"}`}>{d === "channel" ? "Channels" : "Rounds"}</Text>
                  </Pressable>
                ))}
              </View>
              {dim === "channel"
                ? (data.channels.length === 0 ? <Text className="py-3 font-body text-xs text-[#F5F3F057]">No sales in this period.</Text> :
                    data.channels.map((c) => <Row key={c.key} icon={CHAN_ICON[c.key] ?? Utensils} color={CHAN_COLOR[c.key] ?? "#E0875F"} name={c.label} pct={c.pct} amount={rmF(c.revenue)} />))
                : data.rounds.map((r) => <Row key={r.key} icon={ROUND_ICON[r.key] ?? Coffee} color="#FBBF24" name={r.label} pct={Math.round((r.revenue / maxRound) * 100)} amount={rmF(r.revenue)} />)}
            </View>

            {data.warnings?.length ? (
              <Text className="px-1 font-body text-[10px] text-[#F5F3F040]">{data.warnings.join(" · ")}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <RangeSheet visible={sheet} from={cFrom} to={cTo} onApply={applyRange} onClose={() => setSheet(false)} />
      <OutletSheet
        visible={outletSheet}
        outlets={[{ id: "all", name: "All outlets" }, ...(data?.availableOutlets ?? [])]}
        selected={outletId ?? "all"}
        onSelect={(id) => { setOutletId(id); setOutletSheet(false); }}
        onClose={() => setOutletSheet(false)}
      />
    </SafeAreaView>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <View className="flex-1">
      <Text className="font-display text-lg text-[#F5F3F0]">{v}</Text>
      <Text className="mt-0.5 font-body-semi text-[10px] uppercase tracking-wide text-[#F5F3F08a]">{k}</Text>
    </View>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="font-body-semi text-[11px] text-[#F5F3F08a]">{label}</Text>
    </View>
  );
}
function Tile({ icon: Icon, color, v, k, delta }: { icon: any; color: string; v: string; k: string; delta: number | null }) {
  return (
    <View className="flex-1 rounded-2xl border border-[#F5F3F01a] bg-[#160800] p-3.5">
      <View className="mb-2.5 h-8 w-8 items-center justify-center rounded-xl bg-[#F5F3F00f]"><Icon color={color} size={17} /></View>
      <Text className="font-display text-2xl text-[#F5F3F0]">{v}</Text>
      <Text className="mt-1 font-body text-[11px] text-[#F5F3F08a]">{k}</Text>
      <Text className={`mt-1.5 font-body-bold text-[11px] ${deltaUp(delta) ? "text-[#34d399]" : "text-[#f87171]"}`}>{deltaStr(delta)}</Text>
    </View>
  );
}
function Row({ icon: Icon, color, name, pct, amount }: { icon: any; color: string; name: string; pct: number; amount: string }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-[#F5F3F00f] py-3">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#F5F3F00f]"><Icon color={color} size={18} /></View>
      <View className="flex-1">
        <Text className="font-body-semi text-[13px] text-[#F5F3F0]">{name}</Text>
        <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F5F3F014]">
          <View className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }} />
        </View>
      </View>
      <View className="items-end">
        <Text className="font-display text-[13px] text-[#F5F3F0]">{amount}</Text>
        <Text className="mt-0.5 font-body-semi text-[11px] text-[#F5F3F057]">{pct}%</Text>
      </View>
    </View>
  );
}
