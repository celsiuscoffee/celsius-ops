import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Delete,
  RotateCcw,
  Search,
  Users,
  X,
} from "lucide-react-native";
import { useStaff } from "../../../lib/store";
import {
  finalizeStockCount,
  getActiveStockCheck,
  listProducts,
  resetStockCount,
  saveStockCountItem,
  type Package,
  type Product,
  type ServerItem,
} from "../../../lib/ops/inventory";

const STORAGE_AREA_LABEL: Record<string, string> = {
  FRIDGE: "Fridge",
  DRY_STORE: "Dry Store",
  COUNTER: "Counter",
  FREEZER: "Freezer",
  BAR: "Bar",
};
const AREA_ORDER = ["FRIDGE", "COUNTER", "DRY_STORE", "FREEZER", "BAR"];

type Frequency = "daily" | "weekly" | "monthly";
type ItemCount = { qty: number; packageId: string | null };

function key(productId: string, packageId: string | null): string {
  return `${productId}:${packageId ?? ""}`;
}

export default function StockCount() {
  const session = useStaff((s) => s.session);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [keypadProduct, setKeypadProduct] = useState<Product | null>(null);
  const [keypadPkgId, setKeypadPkgId] = useState<string | null>(null);
  const [keypadValue, setKeypadValue] = useState("");
  const [countId, setCountId] = useState<string | null>(null);
  const [serverItems, setServerItems] = useState<Record<string, ServerItem>>({});
  const [submittedToday, setSubmittedToday] = useState<{
    finalizedAt: string | null;
    finalizedBy: { name: string } | null;
    countedBy: { name: string } | null;
  } | null>(null);
  const [startNew, setStartNew] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [conflict, setConflict] = useState<{
    productId: string;
    packageId: string | null;
    pendingQty: number | null;
    serverQty: number | null;
    serverName: string | null;
  } | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await listProducts();
        if (!cancelled) setProducts(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load products");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate active count whenever frequency/startNew changes
  const fetchActive = useCallback(async () => {
    if (!session?.outletId) return;
    try {
      const data = await getActiveStockCheck(
        frequency.toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY",
      );
      if (data.active) {
        setCountId(data.active.id);
        const map: Record<string, ServerItem> = {};
        const localCounts: Record<string, ItemCount> = {};
        for (const it of data.active.items) {
          map[key(it.productId, it.productPackageId)] = it;
          if (it.countedQty != null) {
            localCounts[it.productId] = {
              qty: Number(it.countedQty),
              packageId: it.productPackageId,
            };
          }
        }
        setServerItems(map);
        setCounts(localCounts);
        setSubmittedToday(null);
      } else {
        setCountId(null);
        setServerItems({});
        setSubmittedToday(data.submittedToday ?? null);
      }
    } catch {
      // best effort
    }
  }, [frequency, session?.outletId]);

  useEffect(() => {
    fetchActive();
  }, [fetchActive, startNew]);

  // Polling for collaboration
  useEffect(() => {
    if (!countId) return;
    const id = setInterval(fetchActive, 4000);
    return () => clearInterval(id);
  }, [countId, fetchActive]);

  const groupedData = useMemo(() => {
    const freqKey = frequency.toUpperCase();
    const filtered =
      freqKey === "DAILY"
        ? products.filter((p) => p.checkFrequency === "DAILY")
        : freqKey === "WEEKLY"
          ? products.filter(
              (p) =>
                p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY",
            )
          : products;
    const groups: Record<string, Product[]> = {};
    for (const p of filtered) {
      const area = p.storageArea || "UNCATEGORIZED";
      if (!groups[area]) groups[area] = [];
      groups[area].push(p);
    }
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = AREA_ORDER.indexOf(a);
      const bi = AREA_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((area) => ({ area, items: groups[area] }));
  }, [products, frequency]);

  const totalItems = groupedData.reduce((a, g) => a + g.items.length, 0);
  const countedItems = groupedData.reduce(
    (a, g) => a + g.items.filter((i) => counts[i.id] != null).length,
    0,
  );
  const pct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groupedData;
    return groupedData
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groupedData, search]);

  const contributors = useMemo(() => {
    const tally = new Map<string, { id: string; name: string; count: number }>();
    for (const it of Object.values(serverItems)) {
      if (!it.countedBy) continue;
      const cur = tally.get(it.countedBy.id);
      if (cur) cur.count += 1;
      else
        tally.set(it.countedBy.id, {
          id: it.countedBy.id,
          name: it.countedBy.name,
          count: 1,
        });
    }
    return Array.from(tally.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
  }, [serverItems]);

  function defaultPkg(p: Product): Package | null {
    if (p.packages.length === 0) return null;
    return [...p.packages].sort((a, b) => {
      const diff = a.conversion - b.conversion;
      if (diff !== 0) return diff;
      return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
    })[0];
  }

  function uomLabel(p: Product, packageId?: string | null): string {
    if (packageId) {
      const pkg = p.packages.find((pk) => pk.id === packageId);
      if (pkg) return pkg.label || pkg.name;
    }
    const pkg = defaultPkg(p);
    return pkg ? pkg.label || pkg.name : p.baseUom;
  }

  const openKeypad = (p: Product) => {
    const existing = counts[p.id];
    const dpkg = defaultPkg(p);
    setKeypadProduct(p);
    setKeypadPkgId(existing?.packageId || dpkg?.id || null);
    setKeypadValue(existing ? String(existing.qty) : "");
  };

  const press = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (k === "back") {
      setKeypadValue((v) => v.slice(0, -1));
    } else if (k === ".") {
      if (!keypadValue.includes(".")) setKeypadValue((v) => v + ".");
    } else {
      setKeypadValue((v) => (v === "0" && k !== "." ? k : v + k));
    }
  };

  const saveToServer = useCallback(
    async (
      productId: string,
      packageId: string | null,
      qty: number | null,
      force = false,
    ) => {
      const k = key(productId, packageId);
      const existing = serverItems[k];
      try {
        const data = await saveStockCountItem({
          frequency: frequency.toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY",
          productId,
          productPackageId: packageId,
          countedQty: qty,
          ...(force
            ? {}
            : { expectedPriorCountedById: existing?.countedById ?? null }),
        });
        if (data.countId !== countId) setCountId(data.countId);
        setServerItems((prev) => {
          const next = { ...prev };
          for (const it of data.items) {
            next[key(it.productId, it.productPackageId)] = it;
          }
          return next;
        });
        return true;
      } catch (e) {
        // Detect conflict via body
        const err = e as {
          status?: number;
          body?: { conflicts?: { countedByName?: string; countedQty?: number | null }[] };
        };
        if (err.status === 409 && err.body?.conflicts?.[0]) {
          const c = err.body.conflicts[0];
          setConflict({
            productId,
            packageId,
            pendingQty: qty,
            serverQty: c.countedQty ?? null,
            serverName: c.countedByName ?? null,
          });
          return false;
        }
        Alert.alert("Save failed", e instanceof Error ? e.message : "Try again.");
        return false;
      }
    },
    [frequency, countId, serverItems],
  );

  const confirmKeypad = async () => {
    if (!keypadProduct) return;
    const qty = parseFloat(keypadValue);
    if (isNaN(qty) || qty < 0) return;
    const productId = keypadProduct.id;
    const packageId = keypadPkgId;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    setCounts((prev) => ({ ...prev, [productId]: { qty, packageId } }));
    setKeypadProduct(null);
    void saveToServer(productId, packageId, qty);
  };

  const clearKeypad = () => {
    if (!keypadProduct) return;
    const productId = keypadProduct.id;
    const packageId = keypadPkgId;
    setCounts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setKeypadProduct(null);
    if (countId) void saveToServer(productId, packageId, null);
  };

  const handleFinalize = async () => {
    if (!countId) return;
    if (countedItems < totalItems) {
      Alert.alert(
        "Not done yet",
        `${totalItems - countedItems} items still uncounted.`,
      );
      return;
    }
    setFinalizing(true);
    try {
      await finalizeStockCount(countId);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      Alert.alert("Done", `Stock count finalized — ${countedItems} items.`);
      setCounts({});
      setCountId(null);
      setServerItems({});
      setStartNew((v) => !v);
    } catch (e) {
      Alert.alert("Couldn't finalize", e instanceof Error ? e.message : "Try again.");
    } finally {
      setFinalizing(false);
    }
  };

  const handleReset = async () => {
    if (countId) {
      try {
        await resetStockCount(countId);
      } catch (e) {
        Alert.alert("Reset failed", e instanceof Error ? e.message : "Try again.");
        return;
      }
    }
    setCounts({});
    setCountId(null);
    setServerItems({});
  };

  // ── Render branches ──
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  if (error && products.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-danger text-center">{error}</Text>
      </View>
    );
  }

  if (submittedToday && !startNew) {
    const time = submittedToday.finalizedAt;
    const name =
      submittedToday.finalizedBy?.name ??
      submittedToday.countedBy?.name ??
      "Someone";
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <Check color="#15803D" size={32} />
        </View>
        <Text className="mt-4 text-xl font-display text-espresso text-center">
          Today's {frequency} count is done
        </Text>
        <Text className="mt-1 text-sm font-body text-muted-fg text-center">
          Finalized by {name}
          {time
            ? ` at ${new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </Text>
        <Pressable
          onPress={() => setStartNew(true)}
          className="mt-6 h-14 items-center justify-center rounded-2xl bg-primary px-8 active:opacity-80"
        >
          <Text className="text-base font-body-bold text-white">
            Start new count
          </Text>
        </Pressable>
        <Text className="mt-3 max-w-xs text-center text-xs text-muted">
          Only start a new count if you need to re-count after a delivery or
          adjustment.
        </Text>
      </View>
    );
  }

  return (
    <Screen>
      <PageHeader title="Stock count" back />
      {/* Sticky frequency tabs — sits below the PageHeader. */}
      <View className="border-b border-border bg-background pb-3">
        <View className="flex-row items-center gap-2">
          {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFrequency(f)}
              className={`rounded-full px-3 py-1.5 ${
                frequency === f ? "bg-primary" : "bg-primary-50"
              }`}
            >
              <Text
                className={`text-xs font-body-bold capitalize ${
                  frequency === f ? "text-white" : "text-primary"
                }`}
              >
                {f}
              </Text>
            </Pressable>
          ))}
          {countedItems > 0 ? (
            <Pressable
              onPress={() =>
                Alert.alert("Reset count?", "Clears all counted items.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Reset", style: "destructive", onPress: handleReset },
                ])
              }
              className="ml-auto flex-row items-center gap-1 px-2 py-1"
            >
              <RotateCcw color="#6B6B6B" size={12} />
              <Text className="text-xs font-body text-muted">Reset</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-xs font-body text-muted">
            <Text className="font-body-bold text-espresso">
              {countedItems}/{totalItems}
            </Text>{" "}
            counted
          </Text>
          <View
            className={`rounded-full px-2 py-0.5 ${countedItems === totalItems ? "bg-success" : "bg-primary-50"}`}
          >
            <Text
              className={`text-[10px] font-body-bold ${countedItems === totalItems ? "text-white" : "text-primary"}`}
            >
              {pct}%
            </Text>
          </View>
        </View>
        <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary-50">
          <View
            className={`h-full ${pct === 100 ? "bg-success" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </View>

        {contributors.length > 0 ? (
          <View className="mt-2 flex-row items-center gap-1.5">
            <Users color="#9CA3AF" size={12} />
            {contributors.slice(0, 4).map((c) => (
              <View
                key={c.id}
                className={`rounded-full px-2 py-0.5 ${
                  c.id === session?.userId ? "bg-primary-50" : "bg-blue-50"
                }`}
              >
                <Text
                  className={`text-[10px] font-body-bold ${
                    c.id === session?.userId ? "text-primary" : "text-blue-700"
                  }`}
                >
                  {c.id === session?.userId ? "You" : c.name.split(" ")[0]} ·{" "}
                  {c.count}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Search */}
        <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3 h-12">
          <Search color="#9CA3AF" size={16} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search product…"
            placeholderTextColor="#9CA3AF"
            className="flex-1 text-base font-body text-espresso"
          />
        </View>
      </View>

      {/* List */}
      <FlatList
        data={filteredGroups}
        keyExtractor={(g) => g.area}
        contentContainerClassName="px-5 pt-3 pb-32"
        renderItem={({ item: group }) => {
          const isCollapsed = collapsed.has(group.area);
          const total = group.items.length;
          const counted = group.items.filter((i) => counts[i.id] != null).length;
          const allDone = counted === total;
          return (
            <View>
              <Pressable
                onPress={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.area)) next.delete(group.area);
                    else next.add(group.area);
                    return next;
                  })
                }
                className="flex-row items-center gap-2 py-2"
              >
                {isCollapsed ? (
                  <ChevronRight color="#9CA3AF" size={16} />
                ) : (
                  <ChevronDown color="#9CA3AF" size={16} />
                )}
                <Text className="text-xs font-body-bold uppercase tracking-wide text-muted">
                  {STORAGE_AREA_LABEL[group.area] ?? group.area}
                </Text>
                <Text
                  className={`text-xs font-body ${allDone ? "text-success" : "text-muted"}`}
                >
                  {counted}/{total}
                </Text>
                {allDone ? <Check color="#15803D" size={14} /> : null}
              </Pressable>
              {!isCollapsed ? (
                <View className="gap-1.5">
                  {group.items.map((item) => {
                    const c = counts[item.id];
                    const isCounted = c != null;
                    const u = uomLabel(item, c?.packageId);
                    const serverIt =
                      serverItems[key(item.id, c?.packageId ?? null)];
                    const byOther =
                      serverIt?.countedBy &&
                      serverIt.countedBy.id !== session?.userId;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => openKeypad(item)}
                        className={`flex-row items-center gap-3 rounded-2xl border px-3 py-3 active:opacity-90 ${
                          isCounted
                            ? "border-success/30 bg-success/5"
                            : "border-border bg-surface"
                        }`}
                      >
                        <View
                          className={`h-11 w-11 items-center justify-center rounded-xl ${
                            isCounted ? "bg-success/10" : "bg-primary-50"
                          }`}
                        >
                          <Text
                            className={`text-sm font-body-bold tabular-nums ${
                              isCounted ? "text-success" : "text-muted"
                            }`}
                          >
                            {isCounted ? c.qty : "—"}
                          </Text>
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-sm font-body-medium text-espresso"
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <View className="flex-row items-center gap-1.5">
                            <Text className="text-xs font-body text-muted">
                              {u}
                            </Text>
                            {byOther && serverIt?.countedAt ? (
                              <View className="rounded bg-blue-50 px-1.5 py-px">
                                <Text className="text-[10px] font-body-bold text-blue-700">
                                  {serverIt.countedBy!.name.split(" ")[0]}{" "}
                                  {new Date(serverIt.countedAt).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        {isCounted ? (
                          <Check color="#15803D" size={16} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <View className="h-3" />
            </View>
          );
        }}
      showsVerticalScrollIndicator={false}
    />

      {/* Finalize CTA pinned bottom */}
      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3 pb-8">
        <Pressable
          onPress={handleFinalize}
          disabled={countedItems < totalItems || finalizing}
          className={`h-16 items-center justify-center rounded-2xl ${
            countedItems < totalItems || finalizing
              ? "bg-primary/40"
              : "bg-primary"
          }`}
        >
          {finalizing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-body-bold text-white">
              {countedItems < totalItems
                ? `Count ${totalItems - countedItems} more`
                : `Finalize count (${countedItems}/${totalItems})`}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Keypad overlay */}
      <Modal
        visible={keypadProduct !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setKeypadProduct(null)}
      >
        {keypadProduct ? (
          <KeypadView
            product={keypadProduct}
            pkgId={keypadPkgId}
            setPkgId={setKeypadPkgId}
            value={keypadValue}
            onPress={press}
            onConfirm={confirmKeypad}
            onClear={clearKeypad}
            onCancel={() => setKeypadProduct(null)}
            hasExisting={counts[keypadProduct.id] != null}
            defaultPkg={defaultPkg}
            uomLabel={uomLabel}
          />
        ) : null}
      </Modal>

      {/* Conflict modal */}
      <Modal
        visible={conflict !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setConflict(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          {conflict ? (
            <View className="rounded-t-3xl bg-background p-5">
              <View className="flex-row items-start gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                  <AlertTriangle color="#F59E0B" size={20} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-display text-espresso">
                    {conflict.serverName ?? "Someone"} already counted this
                  </Text>
                  <Text className="mt-1 text-sm font-body text-muted-fg">
                    They saved{" "}
                    <Text className="text-espresso font-body-bold">
                      {conflict.serverQty ?? "—"}
                    </Text>
                    . You're overwriting with{" "}
                    <Text className="text-espresso font-body-bold">
                      {conflict.pendingQty}
                    </Text>
                    .
                  </Text>
                </View>
              </View>
              <View className="mt-5 flex-row gap-2">
                <Pressable
                  onPress={() => {
                    // revert local
                    setCounts((prev) => {
                      const next = { ...prev };
                      if (conflict.serverQty != null) {
                        next[conflict.productId] = {
                          qty: conflict.serverQty,
                          packageId: conflict.packageId,
                        };
                      } else {
                        delete next[conflict.productId];
                      }
                      return next;
                    });
                    setConflict(null);
                  }}
                  className="h-14 flex-1 items-center justify-center rounded-2xl border border-border"
                >
                  <Text className="text-sm font-body-bold text-espresso">
                    Keep theirs
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const c = conflict;
                    setConflict(null);
                    await saveToServer(
                      c.productId,
                      c.packageId,
                      c.pendingQty,
                      true,
                    );
                  }}
                  className="h-14 flex-1 items-center justify-center rounded-2xl bg-primary"
                >
                  <Text className="text-sm font-body-bold text-white">
                    Overwrite
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

function KeypadView({
  product,
  pkgId,
  setPkgId,
  value,
  onPress,
  onConfirm,
  onClear,
  onCancel,
  hasExisting,
  defaultPkg,
  uomLabel,
}: {
  product: Product;
  pkgId: string | null;
  setPkgId: (id: string) => void;
  value: string;
  onPress: (k: string) => void;
  onConfirm: () => void;
  onClear: () => void;
  onCancel: () => void;
  hasExisting: boolean;
  defaultPkg: (p: Product) => Package | null;
  uomLabel: (p: Product, pkgId?: string | null) => string;
}) {
  const typed = parseFloat(value);
  const pkg = pkgId
    ? product.packages.find((p) => p.id === pkgId)
    : defaultPkg(product);
  const cf = pkg?.conversion || 1;
  const showConv = !isNaN(typed) && typed > 0 && cf > 1;

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="border-b border-border px-5 pt-12 pb-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text
              className="text-base font-body-bold text-espresso"
              numberOfLines={1}
            >
              {product.name}
            </Text>
            <Text className="text-xs font-body text-muted">{product.sku}</Text>
          </View>
          <Pressable onPress={onCancel} className="h-10 w-10 items-center justify-center rounded-full">
            <X color="#6B6B6B" size={20} />
          </Pressable>
        </View>
        {product.packages.length > 1 ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {product.packages.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setPkgId(p.id)}
                className={`rounded-full border-2 px-4 py-2 ${
                  pkgId === p.id
                    ? "border-primary bg-primary-50"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-sm font-body-bold ${pkgId === p.id ? "text-primary" : "text-muted-fg"}`}
                >
                  {p.label || p.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : product.packages.length === 1 ? (
          <Text className="mt-2 text-sm font-body text-muted">
            Count in:{" "}
            <Text className="font-body-bold text-espresso">
              {product.packages[0].label || product.packages[0].name}
            </Text>
          </Text>
        ) : null}
      </View>

      {/* Display */}
      <View className="flex-1 items-center justify-center px-6">
        <Text
          className={`text-7xl font-display tabular-nums ${value ? "text-espresso" : "text-muted/40"}`}
        >
          {value || "0"}
        </Text>
        <Text className="mt-2 text-sm font-body text-muted">
          {uomLabel(product, pkgId)}
        </Text>
        {showConv ? (
          <Text className="mt-3 text-xs font-body text-amber-700">
            ={" "}
            <Text className="font-body-bold">
              {(typed * cf).toLocaleString()}
            </Text>{" "}
            {product.baseUom}{" "}
            <Text className="text-muted">
              ({typed} × {cf.toLocaleString()})
            </Text>
          </Text>
        ) : null}
      </View>

      {/* Keypad */}
      <View className="border-t border-border bg-primary-50/30 px-3 pt-3 pb-10">
        <View className="flex-row flex-wrap justify-center">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map(
            (k) => (
              <Pressable
                key={k}
                onPress={() => onPress(k)}
                className={`m-1 h-[4.5rem] w-[31%] items-center justify-center rounded-2xl active:opacity-70 ${
                  k === "back" ? "bg-primary-50" : "bg-surface"
                }`}
                style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 2 }}
              >
                {k === "back" ? (
                  <Delete color="#4A4A4A" size={22} />
                ) : (
                  <Text className="text-2xl font-display text-espresso">
                    {k}
                  </Text>
                )}
              </Pressable>
            ),
          )}
        </View>
        <View className="mt-2 flex-row gap-2 px-1">
          {hasExisting ? (
            <Pressable
              onPress={onClear}
              className="h-14 flex-1 items-center justify-center rounded-2xl border border-danger/30"
            >
              <Text className="text-base font-body-bold text-danger">Clear</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onConfirm}
            disabled={!value}
            className={`h-14 flex-1 items-center justify-center rounded-2xl ${value ? "bg-primary" : "bg-primary/40"}`}
          >
            <Text className="text-base font-body-bold text-white">Save</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
