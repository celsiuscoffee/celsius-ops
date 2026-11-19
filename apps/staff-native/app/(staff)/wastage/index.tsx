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
import { useCelsius } from "../../../lib/celsius-ui";

const REASONS = [
  "Expired",
  "Spillage",
  "Breakage",
  "Quality Issue",
  "Other",
];

type Step = "product" | "quantity" | "reason";

export default function WastagePage() {
  const C = useCelsius().color;
  const session = useStaff((s) => s.session);
  const [entries, setEntries] = useState<WastageEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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
      // Products are a best-effort lookup for the record sheet, so a
      // failure there shouldn't blank the screen. The wastage list is the
      // primary content, a fetch failure there is surfaced as an error
      // state (not an empty list) so a server error can't look like "no
      // wastage yet".
      const productsData = await listProducts().catch(() => []);
      const entriesData = await listWastage(session?.outletId);
      setEntries(entriesData);
      setProducts(productsData);
      setError(false);
    } catch {
      setError(true);
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
      <Screen edges={["top", "left", "right"]}>
        <PageHeader title="Wastage" back />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={C["text-3"]} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Wastage" back />
      <FlatList
        className="flex-1"
        data={entries}
        keyExtractor={(w) => w.id}
        contentContainerClassName="pt-2"
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={C["text-3"]}
          />
        }
        ListHeaderComponent={
          <View>
            <View className="flex-row items-center gap-3 rounded-2xl border border-danger bg-danger-soft px-4 py-4">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-danger-soft">
                <AlertTriangle color={C.danger} size={22} />
              </View>
              <View>
                <Text className="text-xs font-body text-danger-text">
                  Total waste cost
                </Text>
                <Text className="text-xl font-display text-danger-text">
                  RM {totalWaste.toFixed(2)}
                </Text>
              </View>
            </View>
            <Text className="mt-5 mb-2 text-sm font-body-semi text-text-2">
              Recent wastage
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          error ? (
            <View className="mt-8 items-center px-6">
              <Text className="text-center text-base font-body-bold text-text">
                Couldn't load wastage
              </Text>
              <Text className="mt-2 text-center text-sm font-body text-text-2">
                Something went wrong. Check your connection and try again.
              </Text>
              <Pressable
                onPress={() => load()}
                className="mt-6 h-12 items-center justify-center rounded-2xl bg-ink px-8 active:opacity-80"
              >
                <Text className="text-base font-body-bold text-on-ink">
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text className="mt-8 text-center text-sm font-body text-text-3">
              No wastage records yet
            </Text>
          )
        }
        renderItem={({ item: w }) => (
          <View className="rounded-2xl border border-line bg-surface px-3 py-2.5">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-base font-body-medium text-text">
                  {w.product}
                </Text>
                <Text className="text-xs font-body text-text-3">
                  {w.quantity} · {w.reason ?? ", "} · {fmtDate(w.createdAt)}
                </Text>
                <Text className="text-xs font-body text-text-3">
                  by {w.adjustedBy}
                </Text>
              </View>
              {w.costAmount != null ? (
                <Text className="text-sm font-body-bold text-danger-text">
                  −RM {w.costAmount.toFixed(2)}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      showsVerticalScrollIndicator={false}
    />

      {/* Pinned bottom CTA */}
      <View
        style={{ paddingBottom: 12 }}
        className="absolute inset-x-0 bottom-0 border-t border-line bg-bg px-5 pt-3"
      >
        <Pressable
          onPress={openSheet}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-ink active:opacity-80"
        >
          <Plus color={C["on-ink"]} size={20} />
          <Text className="text-base font-body-bold text-on-ink">
            Record wastage
          </Text>
        </Pressable>
      </View>

      {/* Bottom sheet, 3 steps */}
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
          <View className="flex-1 bg-bg">
            <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
              <View className="flex-1 flex-row items-center gap-3">
                {step !== "product" ? (
                  <Pressable
                    onPress={() =>
                      setStep(step === "reason" ? "quantity" : "product")
                    }
                    className="h-11 w-11 items-center justify-center rounded-full bg-sunken"
                  >
                    <ArrowLeft color={C["text-2"]} size={16} />
                  </Pressable>
                ) : null}
                <Text className="text-xl font-display text-text">
                  {step === "product"
                    ? "Pick product"
                    : step === "quantity"
                      ? "How much?"
                      : "Why?"}
                </Text>
              </View>
              <Pressable
                onPress={() => setSheetOpen(false)}
                className="min-h-11 justify-center px-3"
              >
                <Text className="text-sm font-body-bold text-text-3">
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
                      ? "bg-ink"
                      : i < ["product", "quantity", "reason"].indexOf(step)
                        ? "bg-ink opacity-60"
                        : "bg-sunken"
                  }`}
                />
              ))}
            </View>

            {/* Step content */}
            {step === "product" ? (
              <View className="flex-1 px-5 pt-4">
                <View className="flex-row items-center gap-2 rounded-2xl border border-line bg-surface px-3 h-12">
                  <Search color={C["text-3"]} size={16} />
                  <TextInput
                    value={productSearch}
                    onChangeText={setProductSearch}
                    placeholder="Search product…"
                    placeholderTextColor={C["text-3"]}
                    autoFocus
                    className="flex-1 text-base font-body text-text"
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
                      className="rounded-2xl border border-line bg-surface px-3 py-3 active:bg-sunken"
                    >
                      <Text className="text-base font-body-medium text-text">
                        {p.name}
                      </Text>
                      <Text className="text-xs font-body text-text-3">
                        {p.sku} · {p.baseUom}
                      </Text>
                    </Pressable>
                  )}
      showsVerticalScrollIndicator={false}
    />
              </View>
            ) : step === "quantity" ? (
              <View className="flex-1 items-center justify-center px-5">
                <Text className="text-sm font-body text-text-3">
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
                      placeholderTextColor={C["text-3"]}
                      keyboardType="decimal-pad"
                      className="text-7xl font-display text-text tabular-nums text-center"
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
                <Text className="mt-1 text-sm font-body text-text-3">
                  {selectedProduct?.baseUom}
                </Text>
                <Pressable
                  onPress={() => qty && setStep("reason")}
                  disabled={!qty || parseFloat(qty) <= 0}
                  className={`mt-10 h-14 w-full items-center justify-center rounded-2xl ${
                    qty && parseFloat(qty) > 0
                      ? "bg-ink"
                      : "bg-ink opacity-40"
                  }`}
                >
                  <Text className="text-base font-body-bold text-on-ink">
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
                <Text className="text-sm font-body-semi text-text-2">
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
                      className={`min-h-11 justify-center rounded-full border-2 px-4 py-2 ${
                        reason === r
                          ? "border-ink bg-sunken"
                          : "border-line bg-surface"
                      }`}
                    >
                      <Text
                        className={`text-sm font-body-bold ${reason === r ? "text-text" : "text-text-2"}`}
                      >
                        {r}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text className="mt-5 text-sm font-body-semi text-text-2">
                  Notes (optional)
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Additional details…"
                  placeholderTextColor={C["text-3"]}
                  multiline
                  className="mt-2 min-h-16 rounded-2xl border border-line bg-surface px-4 py-3 text-base font-body text-text"
                />

                <View className="mt-6 rounded-2xl border border-line bg-surface p-3">
                  <Text className="text-sm font-body-semi text-text-2">
                    Summary
                  </Text>
                  <Text className="mt-1 text-base font-body-bold text-text">
                    {selectedProduct?.name}
                  </Text>
                  <Text className="text-sm font-body text-text-2">
                    {qty} {selectedProduct?.baseUom} · {reason || ", "}
                  </Text>
                </View>

                <Pressable
                  onPress={submit}
                  disabled={!reason || submitting}
                  className={`mt-6 h-16 flex-row items-center justify-center gap-2 rounded-2xl ${
                    reason && !submitting ? "bg-ink" : "bg-ink opacity-40"
                  }`}
                >
                  {submitting ? (
                    <ActivityIndicator color={C["on-ink"]} />
                  ) : (
                    <>
                      <Trash2 color={C["on-ink"]} size={20} />
                      <Text className="text-base font-body-bold text-on-ink">
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
      className="h-14 w-14 items-center justify-center rounded-2xl border-2 border-line-2 active:bg-sunken"
    >
      <Text className="text-2xl font-display text-text">{sign}</Text>
    </Pressable>
  );
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
