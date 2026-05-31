import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Plus,
  Search,
  Trash2,
} from "lucide-react-native";
import { useStaff } from "../../../lib/store";
import {
  listProducts,
  listWastage,
  recordWastage,
  type Product,
  type WastageEntry,
} from "../../../lib/ops/inventory";

const REASONS = [
  "Expired",
  "Spillage",
  "Breakage",
  "Quality Issue",
  "Other",
];

type Step = "product" | "quantity" | "reason";

export default function WastagePage() {
  const session = useStaff((s) => s.session);
  const [entries, setEntries] = useState<WastageEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [step, setStep] = useState<Step>("product");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [entriesData, productsData] = await Promise.all([
        listWastage(session?.outletId).catch(() => []),
        listProducts().catch(() => []),
      ]);
      setEntries(entriesData);
      setProducts(productsData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalWaste = entries.reduce(
    (a, w) => a + (w.costAmount ?? 0),
    0,
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 30);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [products, productSearch]);

  const openSheet = () => {
    setStep("product");
    setSelectedProduct(null);
    setProductSearch("");
    setQty("");
    setReason("");
    setNotes("");
    setSheetOpen(true);
  };

  const submit = async () => {
    if (!selectedProduct || !qty || !reason || !session?.userId) return;
    setSubmitting(true);
    try {
      await recordWastage({
        outletId: session.outletId,
        productId: selectedProduct.id,
        quantity: parseFloat(qty),
        reason,
        notes: notes || null,
        adjustedById: session.userId,
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setSheetOpen(false);
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't save",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <PageHeader title="Wastage" back />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Wastage" back />
      <FlatList
        className="flex-1"
        data={entries}
        keyExtractor={(w) => w.id}
        contentContainerClassName="pt-2 pb-32"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#A2492C"
          />
        }
        ListHeaderComponent={
          <View>
            <View className="flex-row items-center gap-3 rounded-3xl border border-danger/20 bg-danger/5 px-4 py-4">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-danger/10">
                <AlertTriangle color="#B91C1C" size={22} />
              </View>
              <View>
                <Text className="text-xs font-body text-danger">
                  Total waste cost
                </Text>
                <Text className="text-xl font-display text-danger">
                  RM {totalWaste.toFixed(2)}
                </Text>
              </View>
            </View>
            <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Recent wastage
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <Text className="mt-8 text-center text-sm font-body text-muted">
            No wastage records yet
          </Text>
        }
        renderItem={({ item: w }) => (
          <View className="rounded-2xl border border-border bg-surface px-3 py-2.5">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-body-medium text-espresso">
                  {w.product}
                </Text>
                <Text className="text-xs font-body text-muted">
                  {w.quantity} · {w.reason ?? "—"} · {fmtDate(w.createdAt)}
                </Text>
                <Text className="text-xs font-body text-muted">
                  by {w.adjustedBy}
                </Text>
              </View>
              {w.costAmount != null ? (
                <Text className="text-sm font-body-bold text-danger">
                  −RM {w.costAmount.toFixed(2)}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      showsVerticalScrollIndicator={false}
    />

      {/* Pinned bottom CTA */}
      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3 pb-8">
        <Pressable
          onPress={openSheet}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80"
        >
          <Plus color="#FFFFFF" size={20} />
          <Text className="text-base font-body-bold text-white">
            Record wastage
          </Text>
        </Pressable>
      </View>

      {/* Bottom sheet — 3 steps */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheetOpen(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-background">
            <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
              <View className="flex-1 flex-row items-center gap-3">
                {step !== "product" ? (
                  <Pressable
                    onPress={() =>
                      setStep(step === "reason" ? "quantity" : "product")
                    }
                    className="h-9 w-9 items-center justify-center rounded-full bg-primary-50"
                  >
                    <ArrowLeft color="#A2492C" size={16} />
                  </Pressable>
                ) : null}
                <Text className="text-xl font-display text-espresso">
                  {step === "product"
                    ? "Pick product"
                    : step === "quantity"
                      ? "How much?"
                      : "Why?"}
                </Text>
              </View>
              <Pressable
                onPress={() => setSheetOpen(false)}
                className="px-2 py-1"
              >
                <Text className="text-sm font-body-bold text-muted">
                  Cancel
                </Text>
              </Pressable>
            </View>

            {/* Step indicator */}
            <View className="flex-row gap-1 px-5 pt-3">
              {(["product", "quantity", "reason"] as Step[]).map((s, i) => (
                <View
                  key={s}
                  className={`h-1 flex-1 rounded-full ${
                    step === s
                      ? "bg-primary"
                      : i < ["product", "quantity", "reason"].indexOf(step)
                        ? "bg-primary/60"
                        : "bg-primary-50"
                  }`}
                />
              ))}
            </View>

            {/* Step content */}
            {step === "product" ? (
              <View className="flex-1 px-5 pt-4">
                <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3 h-12">
                  <Search color="#9CA3AF" size={16} />
                  <TextInput
                    value={productSearch}
                    onChangeText={setProductSearch}
                    placeholder="Search product…"
                    placeholderTextColor="#9CA3AF"
                    autoFocus
                    className="flex-1 text-base font-body text-espresso"
                  />
                </View>
                <FlatList
                  className="mt-3"
                  data={filteredProducts}
                  keyExtractor={(p) => p.id}
                  ItemSeparatorComponent={() => <View className="h-2" />}
                  renderItem={({ item: p }) => (
                    <Pressable
                      onPress={() => {
                        setSelectedProduct(p);
                        setStep("quantity");
                      }}
                      className="rounded-2xl border border-border bg-surface px-3 py-3 active:bg-primary-50"
                    >
                      <Text className="text-sm font-body-medium text-espresso">
                        {p.name}
                      </Text>
                      <Text className="text-xs font-body text-muted">
                        {p.sku} · {p.baseUom}
                      </Text>
                    </Pressable>
                  )}
      showsVerticalScrollIndicator={false}
    />
              </View>
            ) : step === "quantity" ? (
              <View className="flex-1 items-center justify-center px-5">
                <Text className="text-sm font-body text-muted">
                  {selectedProduct?.name}
                </Text>
                <View className="mt-4 flex-row items-center gap-3">
                  <Stepper
                    onChange={(d) =>
                      setQty((v) => {
                        const n = parseFloat(v || "0");
                        const next = Math.max(0, n + d);
                        return String(next);
                      })
                    }
                    sign="-"
                  />
                  <View className="min-w-24 items-center">
                    <TextInput
                      value={qty}
                      onChangeText={setQty}
                      placeholder="0"
                      placeholderTextColor="#D1D5DB"
                      keyboardType="decimal-pad"
                      className="text-7xl font-display text-espresso tabular-nums text-center"
                      style={{ minWidth: 120 }}
                    />
                  </View>
                  <Stepper
                    onChange={(d) =>
                      setQty((v) => {
                        const n = parseFloat(v || "0");
                        const next = Math.max(0, n + d);
                        return String(next);
                      })
                    }
                    sign="+"
                  />
                </View>
                <Text className="mt-1 text-sm font-body text-muted">
                  {selectedProduct?.baseUom}
                </Text>
                <Pressable
                  onPress={() => qty && setStep("reason")}
                  disabled={!qty || parseFloat(qty) <= 0}
                  className={`mt-10 h-14 w-full items-center justify-center rounded-2xl ${
                    qty && parseFloat(qty) > 0
                      ? "bg-primary"
                      : "bg-primary/40"
                  }`}
                >
                  <Text className="text-base font-body-bold text-white">
                    Continue
                  </Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView
                className="flex-1"
                contentContainerClassName="px-5 pt-4 pb-12"
                keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
                <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
                  Reason
                </Text>
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => {
                        setReason(r);
                        Haptics.selectionAsync().catch(() => {});
                      }}
                      className={`rounded-full border-2 px-4 py-2 ${
                        reason === r
                          ? "border-primary bg-primary-50"
                          : "border-border bg-surface"
                      }`}
                    >
                      <Text
                        className={`text-sm font-body-bold ${reason === r ? "text-primary" : "text-muted-fg"}`}
                      >
                        {r}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text className="mt-5 text-xs font-body-semi uppercase tracking-wide text-muted">
                  Notes (optional)
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Additional details…"
                  placeholderTextColor="#9B9B9B"
                  multiline
                  className="mt-2 min-h-16 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
                />

                <View className="mt-6 rounded-2xl border border-border bg-surface p-3">
                  <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
                    Summary
                  </Text>
                  <Text className="mt-1 text-base font-body-bold text-espresso">
                    {selectedProduct?.name}
                  </Text>
                  <Text className="text-sm font-body text-muted-fg">
                    {qty} {selectedProduct?.baseUom} · {reason || "—"}
                  </Text>
                </View>

                <Pressable
                  onPress={submit}
                  disabled={!reason || submitting}
                  className={`mt-6 h-16 flex-row items-center justify-center gap-2 rounded-2xl ${
                    reason && !submitting ? "bg-primary" : "bg-primary/40"
                  }`}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Trash2 color="#FFFFFF" size={20} />
                      <Text className="text-base font-body-bold text-white">
                        Record wastage
                      </Text>
                    </>
                  )}
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function Stepper({
  onChange,
  sign,
}: {
  onChange: (d: number) => void;
  sign: "+" | "-";
}) {
  return (
    <Pressable
      onPress={() => {
        onChange(sign === "+" ? 1 : -1);
        Haptics.selectionAsync().catch(() => {});
      }}
      className="h-14 w-14 items-center justify-center rounded-2xl border-2 border-primary/40 active:bg-primary-50"
    >
      <Text className="text-2xl font-display text-primary">{sign}</Text>
    </Pressable>
  );
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
