import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ChevronRight, FileText, MessageCircle } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Card, EmptyState, Pill, SkeletonList } from "../../../components/ui";
import {
  buildPopMessage,
  fetchPopShortlink,
  listInvoices,
  type InvoiceListItem,
  type InvoiceStatus,
} from "../../../lib/ops/invoices";

type TabKey = "unpaid" | "paid" | "all" | "pending_invoice";

const TAB_LABEL: Record<TabKey, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  all: "All",
  pending_invoice: "Pending",
};

const STATUS_TONE: Record<
  InvoiceStatus,
  { label: string; tone: "success" | "danger" | "brand" | "muted" | "warning" }
> = {
  DRAFT: { label: "Draft", tone: "muted" },
  PENDING: { label: "Pending", tone: "warning" },
  INITIATED: { label: "Initiated", tone: "brand" },
  PARTIALLY_PAID: { label: "Partial", tone: "warning" },
  DEPOSIT_PAID: { label: "Deposit paid", tone: "brand" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export default function InvoicesList() {
  const router = useRouter();
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("unpaid");
  // Inline Send-POP per row — track which invoice is mid-flight so the
  // tapped row shows a spinner instead of the icon. Single value (only
  // one POP fires at a time).
  const [sendingPopId, setSendingPopId] = useState<string | null>(null);

  async function sendPop(inv: InvoiceListItem) {
    if (sendingPopId) return;
    setSendingPopId(inv.id);
    try {
      // Reuse the stored shortlink when present; otherwise mint a fresh
      // one. Fall back to the last photo URL if shortlink minting
      // fails so the supplier always gets a working receipt link.
      let receiptUrl = inv.popShortLink ?? null;
      if (!receiptUrl) {
        try {
          const r = await fetchPopShortlink(inv.id);
          receiptUrl = r.shortLink;
          // Patch local state so subsequent taps skip the mint round-trip.
          setItems((prev) =>
            prev.map((x) =>
              x.id === inv.id ? { ...x, popShortLink: r.shortLink } : x,
            ),
          );
        } catch {
          // ignore
        }
      }
      if (!receiptUrl && inv.photos.length > 0) {
        receiptUrl = inv.photos[inv.photos.length - 1];
      }
      if (!receiptUrl) {
        Alert.alert(
          "No receipt available",
          `Open ${inv.invoiceNumber} and snap a payment receipt first.`,
        );
        return;
      }
      const msg = buildPopMessage(
        {
          invoiceNumber: inv.invoiceNumber,
          amount: inv.amount,
          amountPaid: inv.amountPaid,
          depositAmount: inv.depositAmount,
          depositPercent: inv.depositPercent,
          depositRef: inv.depositRef,
          paymentRef: inv.paymentRef,
          dueDate: inv.dueDate,
          status: inv.status,
        },
        receiptUrl,
      );
      const text = encodeURIComponent(msg);
      const phone = inv.supplierPhone?.replace(/\D/g, "") ?? "";
      const url = phone
        ? `https://wa.me/${phone}?text=${text}`
        : `https://wa.me/?text=${text}`;
      Linking.openURL(url).catch(() => {});
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    } finally {
      setSendingPopId(null);
    }
  }

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await listInvoices({ tab }).catch(() => ({
          items: [] as InvoiceListItem[],
        }));
        setItems(data.items);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  // Quick GRNI count for the summary card — sourced from the
  // pending_invoice tab regardless of the active tab.
  const [grniCount, setGrniCount] = useState(0);
  useEffect(() => {
    listInvoices({ tab: "pending_invoice" })
      .then((d) => setGrniCount(d.items.length))
      .catch(() => {});
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  return (
    <Screen>
      <View className="pt-3">
        <PageHeader
          title="Invoices"
          subtitle="Supplier invoices & payment status"
          back
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-24"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor="#C2452D"
            colors={["#C2452D"]}
          />
        }
      >
        {/* GRNI summary card — surface invoices waiting to be attached */}
        {grniCount > 0 && tab !== "pending_invoice" ? (
          <Pressable
            onPress={() => setTab("pending_invoice")}
            className="mb-3 flex-row items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-50 px-4 py-3.5 active:opacity-90"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15">
              <FileText color="#D97706" size={20} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-body-bold text-amber-700">
                {grniCount} invoice{grniCount === 1 ? "" : "s"} to attach
              </Text>
              <Text className="mt-0.5 text-xs font-body text-amber-700/80">
                Goods received — waiting for the real supplier invoice
              </Text>
            </View>
            <ChevronRight color="#D97706" size={16} />
          </Pressable>
        ) : null}

        {/* Tabs */}
        <View className="mb-3 flex-row gap-2">
          {(["unpaid", "paid", "all", "pending_invoice"] as TabKey[]).map(
            (t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                className={`rounded-full px-3 py-1.5 ${
                  tab === t ? "bg-primary" : "bg-primary-50"
                }`}
              >
                <Text
                  className={`text-xs font-body-bold ${
                    tab === t ? "text-white" : "text-primary"
                  }`}
                >
                  {TAB_LABEL[t]}
                </Text>
              </Pressable>
            ),
          )}
        </View>

        {loading && items.length === 0 ? (
          <SkeletonList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices"
            subtitle={
              tab === "pending_invoice"
                ? "No GRNI placeholders waiting."
                : tab === "paid"
                  ? "No paid invoices in this scope."
                  : "Receivings will create placeholder invoices here."
            }
          />
        ) : (
          <View className="gap-2">
            {items.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                isOverdue={
                  inv.dueDate != null &&
                  inv.status !== "PAID" &&
                  inv.status !== "CANCELLED" &&
                  new Date(inv.dueDate).getTime() < today
                }
                onPress={() =>
                  router.push(`/(staff)/invoices/${inv.id}` as never)
                }
                onSendPop={() => sendPop(inv)}
                sendingPop={sendingPopId === inv.id}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function InvoiceCard({
  invoice,
  isOverdue,
  onPress,
  onSendPop,
  sendingPop,
}: {
  invoice: InvoiceListItem;
  isOverdue: boolean;
  onPress: () => void;
  onSendPop: () => void;
  sendingPop: boolean;
}) {
  const tone = STATUS_TONE[invoice.status] ?? {
    label: invoice.status,
    tone: "muted" as const,
  };
  const isPlaceholder =
    invoice.invoiceNumber.startsWith("INV-") &&
    invoice.dueDate == null &&
    invoice.status === "PENDING";
  // Show inline Send POP button on any paid status, including
  // partial/deposit-paid where suppliers expect a confirmation.
  const canSendPop =
    invoice.status === "PAID" ||
    invoice.status === "DEPOSIT_PAID" ||
    invoice.status === "PARTIALLY_PAID";
  const display = isPlaceholder
    ? "To attach"
    : invoice.invoiceNumber;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={invoice.invoiceNumber}
      className="rounded-3xl border border-border bg-surface px-4 py-3.5 active:bg-primary-50"
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text
            className="text-base font-body-bold text-espresso"
            numberOfLines={1}
          >
            {invoice.supplierName ?? "Unknown supplier"}
          </Text>
          <Text
            className="mt-0.5 text-xs font-body text-muted-fg"
            numberOfLines={1}
          >
            {display}
            {invoice.orderNumber ? ` · ${invoice.orderNumber}` : ""}
            {invoice.outletName ? ` · ${invoice.outletName}` : ""}
          </Text>
        </View>
        <Pill
          label={isOverdue ? "Overdue" : tone.label}
          tone={isOverdue ? "danger" : tone.tone}
        />
      </View>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs font-body text-muted-fg">
          {invoice.dueDate
            ? `Due ${new Date(invoice.dueDate).toLocaleDateString([], {
                day: "numeric",
                month: "short",
              })}`
            : isPlaceholder
              ? "No due date yet"
              : `Created ${new Date(invoice.createdAt).toLocaleDateString([], {
                  day: "numeric",
                  month: "short",
                })}`}
        </Text>
        <Text className="text-sm font-body-bold text-espresso tabular-nums">
          RM {invoice.amount.toFixed(2)}
        </Text>
      </View>

      {/* Inline Send POP — paid statuses only. onPress stop is implicit:
          this Pressable is rendered as a sibling so it doesn't fire the
          outer card onPress (tap propagation only goes up through the
          tree, and React Native treats sibling Pressables independently). */}
      {canSendPop ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onSendPop();
          }}
          disabled={sendingPop}
          className="mt-2.5 h-9 flex-row items-center justify-center gap-1.5 rounded-xl bg-primary-50 active:bg-primary-100"
        >
          {sendingPop ? (
            <ActivityIndicator color="#C2452D" size="small" />
          ) : (
            <>
              <MessageCircle color="#C2452D" size={14} />
              <Text className="text-xs font-body-bold text-primary">
                Send POP
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}
