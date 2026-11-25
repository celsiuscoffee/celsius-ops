import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  FileText,
  Package,
  PackageCheck,
  Receipt,
  ShoppingCart,
  Trash2,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { List, ListRow, Section, SkeletonRow } from "../../../components/ui";
import { useStaff } from "../../../lib/store";
import { hasAccess } from "../../../lib/access";
import { fetchStockLevels } from "../../../lib/ops/stock-levels";
import { useCelsius } from "../../../lib/celsius-ui";

type Op = {
  href: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ color?: string; size?: number }>;
  moduleKey: string;
};

// Grouped by the life of an ingredient at the outlet: what is on the shelf,
// what came in or went out, and what was bought and paid for.
const ON_THE_SHELF: Op[] = [
  {
    href: "/(staff)/stock-count",
    title: "Stock count",
    subtitle: "Count what is on the shelf",
    icon: ClipboardCheck,
    moduleKey: "inventory:stock-count",
  },
  {
    href: "/(staff)/wastage",
    title: "Wastage",
    subtitle: "Log what was thrown away and why",
    icon: Trash2,
    moduleKey: "inventory:wastage",
  },
];

const IN_AND_OUT: Op[] = [
  {
    href: "/(staff)/receiving",
    title: "Receiving",
    subtitle: "Check in a delivery",
    icon: Package,
    moduleKey: "inventory:receivings",
  },
  {
    href: "/(staff)/transfers",
    title: "Transfers",
    subtitle: "Stock moved between outlets",
    icon: ArrowLeftRight,
    moduleKey: "inventory:transfers",
  },
];

const BUY_AND_PAY: Op[] = [
  {
    href: "/(staff)/orders",
    title: "Purchase orders",
    subtitle: "Create, approve and send to suppliers",
    icon: ShoppingCart,
    moduleKey: "inventory:orders",
  },
  {
    href: "/(staff)/invoices",
    title: "Invoices",
    subtitle: "Supplier invoices and proof of payment",
    icon: FileText,
    moduleKey: "inventory:invoices",
  },
  {
    href: "/(staff)/claims",
    title: "Pay and claim",
    subtitle: "Receipts you paid for, and payment requests",
    icon: Receipt,
    moduleKey: "inventory:pay-and-claim",
  },
];

export default function InventoryHub() {
  const C = useCelsius().color;
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
  const can = (op: Op) => hasAccess(session?.role, session?.moduleAccess, op.moduleKey);
  const groups = [
    { title: "On the shelf", ops: ON_THE_SHELF.filter(can) },
    { title: "In and out", ops: IN_AND_OUT.filter(can) },
    { title: "Buy and pay", ops: BUY_AND_PAY.filter(can) },
  ].filter((g) => g.ops.length > 0);

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Stock" subtitle={session?.outletName ?? undefined} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-6"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={C["text-3"]}
            colors={[C["text-2"]]}
          />
        }
      >
        {/* Stock levels: the one thing to look at first. */}
        {alertCount > 0 ? (
          <List>
            <ListRow
              icon={AlertTriangle}
              tone="danger"
              title={`${counts?.critical ?? 0} out, ${counts?.low ?? 0} low`}
              meta="Below par at this outlet. Tap to see which."
              onPress={() => router.push("/(staff)/inventory/levels")}
            />
          </List>
        ) : counts ? (
          <List>
            <ListRow
              icon={PackageCheck}
              tone="ok"
              title="Stock levels healthy"
              meta="Nothing below par. Tap to browse."
              onPress={() => router.push("/(staff)/inventory/levels")}
            />
          </List>
        ) : session?.outletId ? (
          <SkeletonRow />
        ) : null}

        {groups.map((g) => (
          <Section key={g.title} title={g.title}>
            <List>
              {g.ops.map((op) => (
                <ListRow
                  key={op.href}
                  icon={op.icon}
                  title={op.title}
                  meta={op.subtitle}
                  onPress={() => router.push(op.href as never)}
                />
              ))}
            </List>
          </Section>
        ))}
        <View className="h-2" />
      </ScrollView>
    </Screen>
  );
}
