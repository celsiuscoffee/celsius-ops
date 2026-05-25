import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Filter as FilterIcon,
  MessageCircle,
  X as XIcon,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, Pill, SkeletonList } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useStaff } from "../../../lib/store";
import {
  buildPopMessage,
  fetchPopShortlink,
  listInvoices,
  markPopSent,
  type InvoiceListItem,
  type InvoiceStatus,
} from "../../../lib/ops/invoices";

type Supplier = { id: string; name: string };
type Outlet = { id: string; name: string };

// Phase 10 filter set — kept independent of the tab pills so a manager
// can e.g. tab "Paid" + filter "POP not sent" to find the actionable
// backlog. Empty/null on every field = no filter.
type FilterState = {
  popStatus: "sent" | "not_sent" | "";
  supplierId: string;
  outletId: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: FilterState = {
  popStatus: "",
  supplierId: "",
  outletId: "",
  dateFrom: "",
  dateTo: "",
};

function activeFilterCount(f: FilterState) {
  let n = 0;
  if (f.popStatus) n++;
  if (f.supplierId) n++;
  if (f.outletId) n++;
  if (f.dateFrom || f.dateTo) n++;
  return n;
}

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
  const session = useStaff((s) => s.session);
  const { colorScheme } = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#FAFAFA" : "#160800";
  const isManager =
    session?.role === "OWNER" ||
    session?.role === "ADMIN" ||
    session?.role === "MANAGER";

  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("unpaid");
  // Inline Send-POP per row — track which invoice is mid-flight so the
  // tapped row shows a spinner instead of the icon. Single value (only
  // one POP fires at a time).
  const [sendingPopId, setSendingPopId] = useState<string | null>(null);

  // Phase 10 filter state — kept separate from `tab` so a tab change
  // doesn't clobber filters. `pendingFilters` is the draft inside the
  // sheet; we only commit to `filters` (which triggers a re-fetch) on
  // Apply, so dragging the date sheet around doesn't spam the API.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filterSheet, setFilterSheet] = useState(false);
  const [pendingFilters, setPendingFilters] = useState<FilterState>(filters);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  // Picker subsheets live inside the filter sheet so the user can swap
  // a supplier/outlet without losing other in-flight filter edits.
  const [supplierPicker, setSupplierPicker] = useState(false);
  const [outletPicker, setOutletPicker] = useState(false);

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
      // Fire-and-forget: stamp popSentAt on the server so the "POP sent"
      // pill shows up after refresh. Optimistically patch local state
      // first so the row updates immediately even before the round-trip.
      const optimisticTs = new Date().toISOString();
      setItems((prev) =>
        prev.map((x) =>
          x.id === inv.id ? { ...x, popSentAt: optimisticTs } : x,
        ),
      );
      markPopSent(inv.id).catch(() => {
        // Network failure — leave the optimistic pill in place. Next
        // pull-to-refresh will reconcile against the server.
      });
    } finally {
      setSendingPopId(null);
    }
  }

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await listInvoices({
          tab,
          popStatus: filters.popStatus || undefined,
          supplierId: filters.supplierId || undefined,
          outletId: filters.outletId || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }).catch(() => ({ items: [] as InvoiceListItem[] }));
        setItems(data.items);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, filters],
  );

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  // Lazy-load the filter-sheet lookups (suppliers, outlets) on first
  // open — keeps the list-screen mount lean. Outlets only for managers.
  useEffect(() => {
    if (!filterSheet) return;
    if (suppliers.length === 0) {
      api<Array<{ id: string; name: string }>>("/api/suppliers")
        .then((d) => setSuppliers(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
    if (isManager && outlets.length === 0) {
      api<Array<{ id: string; name: string }>>("/api/outlets")
        .then((d) => setOutlets(Array.isArray(d) ? d : []))
        .catch(() => {});
    }
  }, [filterSheet, isManager, suppliers.length, outlets.length]);

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

        {/* Tabs + filter trigger. Filter button sits at the far right so
            tab pills always start from the left edge; the badge dot on
            top of the funnel icon makes "filters active" obvious from
            across the screen. */}
        <View className="mb-3 flex-row items-center gap-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
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
          </ScrollView>
          <Pressable
            onPress={() => {
              setPendingFilters(filters);
              setFilterSheet(true);
            }}
            className={`h-9 w-9 items-center justify-center rounded-full ${
              activeFilterCount(filters) > 0
                ? "bg-primary"
                : "border border-border bg-surface"
            }`}
          >
            <FilterIcon
              color={activeFilterCount(filters) > 0 ? "#FFFFFF" : iconColor}
              size={16}
            />
            {activeFilterCount(filters) > 0 ? (
              <View className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1">
                <Text className="text-[9px] font-body-bold text-white">
                  {activeFilterCount(filters)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Active filter chips — tap to clear a single filter without
            opening the sheet. Keeps the user oriented when results look
            unexpectedly thin. */}
        {activeFilterCount(filters) > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
            className="mb-3"
          >
            {filters.popStatus ? (
              <FilterChip
                label={
                  filters.popStatus === "sent" ? "POP sent" : "POP not sent"
                }
                onClear={() =>
                  setFilters((p) => ({ ...p, popStatus: "" }))
                }
              />
            ) : null}
            {filters.supplierId ? (
              <FilterChip
                label={
                  suppliers.find((s) => s.id === filters.supplierId)?.name ??
                  "Supplier"
                }
                onClear={() =>
                  setFilters((p) => ({ ...p, supplierId: "" }))
                }
              />
            ) : null}
            {filters.outletId ? (
              <FilterChip
                label={
                  outlets.find((o) => o.id === filters.outletId)?.name ??
                  "Outlet"
                }
                onClear={() =>
                  setFilters((p) => ({ ...p, outletId: "" }))
                }
              />
            ) : null}
            {filters.dateFrom || filters.dateTo ? (
              <FilterChip
                label={`${filters.dateFrom || "…"} → ${filters.dateTo || "…"}`}
                onClear={() =>
                  setFilters((p) => ({ ...p, dateFrom: "", dateTo: "" }))
                }
              />
            ) : null}
            <Pressable
              onPress={() => setFilters(EMPTY_FILTERS)}
              className="rounded-full bg-primary-50 px-3 py-1.5 active:opacity-80"
            >
              <Text className="text-xs font-body-bold text-primary">
                Clear all
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}

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

      {/* Filter sheet — committed only on Apply so date typing doesn't
          spam the API. Pickers (supplier/outlet) open as page-sheets on
          top so we don't lose other in-flight filter edits. */}
      <Modal
        visible={filterSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFilterSheet(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-peachi text-espresso">
              Filter invoices
            </Text>
            <Pressable
              onPress={() => setFilterSheet(false)}
              className="px-2 py-1"
            >
              <XIcon color={iconColor} size={20} />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-4 py-4 gap-5">
            {/* POP status — paid-only meaning. Three-state segmented. */}
            <View>
              <Text className="mb-2 text-[11px] font-body-semi uppercase tracking-wide text-muted">
                POP status
              </Text>
              <View className="flex-row gap-2">
                {(
                  [
                    { v: "", l: "Any" },
                    { v: "sent", l: "POP sent" },
                    { v: "not_sent", l: "Not sent" },
                  ] as const
                ).map((opt) => {
                  const selected = pendingFilters.popStatus === opt.v;
                  return (
                    <Pressable
                      key={opt.v || "any"}
                      onPress={() =>
                        setPendingFilters((p) => ({
                          ...p,
                          popStatus: opt.v as FilterState["popStatus"],
                        }))
                      }
                      className={`flex-1 items-center rounded-2xl border px-3 py-2.5 ${
                        selected
                          ? "border-primary bg-primary-50"
                          : "border-border bg-surface"
                      }`}
                    >
                      <Text
                        className={`text-xs font-body-bold ${
                          selected ? "text-primary" : "text-espresso"
                        }`}
                      >
                        {opt.l}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Supplier */}
            <View>
              <Text className="mb-2 text-[11px] font-body-semi uppercase tracking-wide text-muted">
                Supplier
              </Text>
              <Pressable
                onPress={() => setSupplierPicker(true)}
                className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
              >
                <Text
                  className={`flex-1 text-base font-body ${
                    pendingFilters.supplierId ? "text-espresso" : "text-muted"
                  }`}
                  numberOfLines={1}
                >
                  {suppliers.find((s) => s.id === pendingFilters.supplierId)
                    ?.name ?? "Any supplier"}
                </Text>
                {pendingFilters.supplierId ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setPendingFilters((p) => ({ ...p, supplierId: "" }));
                    }}
                    hitSlop={10}
                  >
                    <XIcon color={iconColor} size={16} />
                  </Pressable>
                ) : (
                  <Text className="text-xs font-body-bold text-primary">
                    Pick
                  </Text>
                )}
              </Pressable>
            </View>

            {/* Outlet — manager only */}
            {isManager ? (
              <View>
                <Text className="mb-2 text-[11px] font-body-semi uppercase tracking-wide text-muted">
                  Outlet
                </Text>
                <Pressable
                  onPress={() => setOutletPicker(true)}
                  className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
                >
                  <Text
                    className={`flex-1 text-base font-body ${
                      pendingFilters.outletId ? "text-espresso" : "text-muted"
                    }`}
                    numberOfLines={1}
                  >
                    {outlets.find((o) => o.id === pendingFilters.outletId)
                      ?.name ?? "All outlets"}
                  </Text>
                  {pendingFilters.outletId ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        setPendingFilters((p) => ({ ...p, outletId: "" }));
                      }}
                      hitSlop={10}
                    >
                      <XIcon color={iconColor} size={16} />
                    </Pressable>
                  ) : (
                    <Text className="text-xs font-body-bold text-primary">
                      Pick
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {/* Date range — issueDate. Plain text inputs to keep this
                screen lean; we can swap in a date picker later. */}
            <View>
              <Text className="mb-2 text-[11px] font-body-semi uppercase tracking-wide text-muted">
                Date range (issue date)
              </Text>
              <View className="flex-row gap-2">
                <TextInput
                  value={pendingFilters.dateFrom}
                  onChangeText={(t) =>
                    setPendingFilters((p) => ({ ...p, dateFrom: t }))
                  }
                  placeholder="From YYYY-MM-DD"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  className="h-14 flex-1 rounded-2xl border border-border bg-surface px-3 text-sm font-body text-espresso"
                />
                <TextInput
                  value={pendingFilters.dateTo}
                  onChangeText={(t) =>
                    setPendingFilters((p) => ({ ...p, dateTo: t }))
                  }
                  placeholder="To YYYY-MM-DD"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  className="h-14 flex-1 rounded-2xl border border-border bg-surface px-3 text-sm font-body text-espresso"
                />
              </View>
            </View>

            {/* Reset all */}
            <Pressable
              onPress={() => setPendingFilters(EMPTY_FILTERS)}
              className="mt-2 items-center rounded-2xl border border-border bg-surface py-3 active:bg-primary-50"
            >
              <Text className="text-sm font-body-bold text-primary">
                Reset filters
              </Text>
            </Pressable>
          </ScrollView>

          {/* Apply / Cancel pinned at the bottom */}
          <View className="border-t border-border bg-background px-4 py-3">
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setFilterSheet(false)}
                className="h-14 flex-1 items-center justify-center rounded-2xl border border-border active:bg-primary-50"
              >
                <Text className="text-sm font-body-bold text-espresso">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setFilters(pendingFilters);
                  setFilterSheet(false);
                }}
                className="h-14 flex-1 items-center justify-center rounded-2xl bg-primary active:opacity-90"
              >
                <Text className="text-sm font-body-bold text-white">
                  Apply
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Supplier picker (inside the filter sheet) */}
      <Modal
        visible={supplierPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSupplierPicker(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-peachi text-espresso">
              Pick supplier
            </Text>
            <Pressable
              onPress={() => setSupplierPicker(false)}
              className="px-2 py-1"
            >
              <Text className="text-sm font-body-bold text-muted">Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-4 py-4 gap-2">
            {suppliers.map((s) => {
              const selected = s.id === pendingFilters.supplierId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setPendingFilters((p) => ({ ...p, supplierId: s.id }));
                    setSupplierPicker(false);
                  }}
                  className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 active:bg-primary-50 ${
                    selected
                      ? "border-primary bg-primary-50"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text className="text-base font-body-bold text-espresso">
                    {s.name}
                  </Text>
                  {selected ? <Check color="#C2452D" size={20} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Outlet picker (manager only, inside the filter sheet) */}
      <Modal
        visible={outletPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOutletPicker(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-peachi text-espresso">
              Pick outlet
            </Text>
            <Pressable
              onPress={() => setOutletPicker(false)}
              className="px-2 py-1"
            >
              <Text className="text-sm font-body-bold text-muted">Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-4 py-4 gap-2">
            {outlets.map((o) => {
              const selected = o.id === pendingFilters.outletId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    setPendingFilters((p) => ({ ...p, outletId: o.id }));
                    setOutletPicker(false);
                  }}
                  className={`flex-row items-center justify-between rounded-2xl border px-4 py-3 active:bg-primary-50 ${
                    selected
                      ? "border-primary bg-primary-50"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text className="text-base font-body-bold text-espresso">
                    {o.name}
                  </Text>
                  {selected ? <Check color="#C2452D" size={20} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Pressable
      onPress={onClear}
      className="flex-row items-center gap-1.5 rounded-full border border-primary/30 bg-primary-50 px-3 py-1.5 active:opacity-80"
    >
      <Text className="text-xs font-body-bold text-primary">{label}</Text>
      <XIcon color="#C2452D" size={12} />
    </Pressable>
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
        {/* Two stacked pills: status (mandatory) + POP-sent (only when
            we've stamped popSentAt). Stacking keeps the row compact
            instead of competing for horizontal space with long supplier
            names. */}
        <View className="items-end gap-1">
          <Pill
            label={isOverdue ? "Overdue" : tone.label}
            tone={isOverdue ? "danger" : tone.tone}
          />
          {canSendPop && invoice.popSentAt ? (
            <View className="flex-row items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5">
              <CheckCircle2 color="#10B981" size={10} />
              <Text className="text-[10px] font-body-bold text-emerald-700">
                POP sent
              </Text>
            </View>
          ) : null}
        </View>
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
                {invoice.popSentAt ? "Resend POP" : "Send POP"}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}
