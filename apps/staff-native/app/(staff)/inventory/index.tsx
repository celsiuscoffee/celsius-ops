import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Package,
  Receipt,
  ShoppingCart,
  Trash2,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { SkeletonRow } from "../../../components/ui";
import { useStaff } from "../../../lib/store";
import { hasAccess } from "../../../lib/access";
import { fetchStockLevels } from "../../../lib/ops/stock-levels";

type Op = {
  href: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ color: string; size: number }>;
  iconBg: string;
  iconColor: string;
  moduleKey: string;
};

const OPS: Op[] = [
  {
    href: "/(staff)/stock-count",
    title: "Stock Count",
    subtitle: "Daily stock check",
    icon: ClipboardCheck,
    iconBg: "bg-primary-50",
    iconColor: "#C2452D",
    moduleKey: "inventory:stock-count",
  },
  {
    href: "/(staff)/receiving",
    title: "Receiving",
    subtitle: "Record deliveries",
    icon: Package,
    iconBg: "bg-blue-100/70",
    iconColor: "#2563EB",
    moduleKey: "inventory:receivings",
  },
  {
    href: "/(staff)/wastage",
    title: "Wastage",
    subtitle: "Report waste & spillage",
    icon: Trash2,
    iconBg: "bg-red-100/70",
    iconColor: "#DC2626",
    moduleKey: "inventory:wastage",
  },
  {
    href: "/(staff)/transfers",
    title: "Transfers",
    subtitle: "Inter-outlet transfers",
    icon: ArrowLeftRight,
    iconBg: "bg-purple-100/70",
    iconColor: "#7C3AED",
    moduleKey: "inventory:transfers",
  },
  {
    href: "/(staff)/claims",
    title: "Pay & Claim",
    subtitle: "Receipts & vendor payment requests",
    icon: Receipt,
    iconBg: "bg-amber-100/70",
    iconColor: "#D97706",
    moduleKey: "inventory:pay-and-claim",
  },
  {
    href: "/(staff)/orders",
    title: "Purchase Orders",
    subtitle: "Create, approve & send POs to suppliers",
    icon: ShoppingCart,
    iconBg: "bg-emerald-100/70",
    iconColor: "#059669",
    moduleKey: "inventory:orders",
  },
  {
    href: "/(staff)/invoices",
    title: "Invoices",
    subtitle: "Supplier invoices — paid, unpaid, overdue",
    icon: FileText,
    iconBg: "bg-indigo-100/70",
    iconColor: "#4F46E5",
    moduleKey: "inventory:invoices",
  },
];

export default function InventoryHub() {
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [counts, setCounts] = useState<{ critical: number; low: number } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.outletId) return;
    try {
      const res = await fetchStockLevels(session.outletId);
      const c = { critical: 0, low: 0 };
      for (const i of res.items ?? []) {
        if (i.status === "critical") c.critical++;
        else if (i.status === "low") c.low++;
      }
      setCounts(c);
    } catch {
      setCounts(null);
    } finally {
      setRefreshing(false);
    }
  }, [session?.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const alertCount = (counts?.critical ?? 0) + (counts?.low ?? 0);
  const allowedOps = OPS.filter((op) =>
    hasAccess(session?.role, session?.moduleAccess, op.moduleKey),
  );

  return (
    <Screen>
      {/* Sticky header */}
      <PageHeader title="Inventory" subtitle="Stock operations" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-24"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#C2452D"
            colors={["#C2452D"]}
          />
        }
      >
        {/* Stock status banner */}
        {alertCount > 0 ? (
          <Pressable
            onPress={() => router.push("/(staff)/inventory/levels")}
            accessibilityLabel="Stock alert"
            className="mb-3 flex-row items-center gap-3 rounded-3xl border border-danger/30 bg-danger/5 px-4 py-3.5 active:opacity-90"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-danger/10">
              <AlertTriangle color="#DC2626" size={20} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-body-bold text-danger">
                Stock alert
              </Text>
              <Text className="mt-0.5 text-xs font-body text-danger/80">
                {counts?.critical ?? 0} out, {counts?.low ?? 0} low — tap to
                review
              </Text>
            </View>
            <ChevronRight color="#DC2626" size={16} />
          </Pressable>
        ) : counts ? (
          <Pressable
            onPress={() => router.push("/(staff)/inventory/levels")}
            accessibilityLabel="Stock levels"
            className="mb-3 flex-row items-center gap-3 rounded-3xl border border-success/30 bg-success/5 px-4 py-3.5 active:opacity-90"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-success/10">
              <Package color="#15803D" size={20} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-body-bold text-success">
                Stock levels healthy
              </Text>
              <Text className="mt-0.5 text-xs font-body text-success/80">
                Nothing below par — tap to browse
              </Text>
            </View>
            <ChevronRight color="#15803D" size={16} />
          </Pressable>
        ) : (
          <View className="mb-3">
            <SkeletonRow />
          </View>
        )}

        {/* Operations */}
        <View className="gap-2.5">
          {allowedOps.map((op) => {
            const Icon = op.icon;
            return (
              <Pressable
                key={op.href}
                onPress={() => router.push(op.href as never)}
                accessibilityLabel={op.title}
                className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface px-4 py-3.5 active:bg-primary-50"
              >
                <View
                  className={`h-11 w-11 items-center justify-center rounded-2xl ${op.iconBg}`}
                >
                  <Icon color={op.iconColor} size={20} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-body-bold text-espresso">
                    {op.title}
                  </Text>
                  <Text className="mt-0.5 text-xs font-body text-muted-fg">
                    {op.subtitle}
                  </Text>
                </View>
                <ChevronRight color="#9CA3AF" size={16} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
