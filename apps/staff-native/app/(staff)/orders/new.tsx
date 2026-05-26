import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  Package as PackageIcon,
  Search,
  Send,
  Sparkles,
  Trash2,
  X as XIcon,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Field, Pill, SkeletonList } from "../../../components/ui";
import { api } from "../../../lib/api";
import { useStaff } from "../../../lib/store";
import { createOrder, sendOrder } from "../../../lib/ops/orders";
import {
  fetchAIDecisions,
  type PORecommendation,
} from "../../../lib/ops/ai-decisions";

// Mirrors backoffice /api/inventory/suppliers/products. Each supplier
// carries its own product list (with negotiated price + the supplier's
// packaging) so the picker iterates over `supplier.products` — there's
// no separate global product catalog fetch. This matches the backoffice
// PO-create flow exactly; suppliers and the products they sell are the
// same atomic unit.
type SupplierProduct = {
  id: string;            // productId
  name: string;
  sku: string;
  packageId: string | null;
  packageLabel: string;  // e.g. "1 kg bag"
  price: number;         // supplier's negotiated unit price (pre-fill)
  conversionFactor: number;
};

type Supplier = {
  id: string;
  name: string;
  phone: string;
  leadTimeDays?: number | null;
  products: SupplierProduct[];
};

type CartLine = {
  productId: string;
  productName: string;
  sku: string;
  unitLabel: string;
  packageId: string | null;
  quantity: number;
  unitPrice: number;
};

export default function NewPO() {
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const { colorScheme } = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#FAFAFA" : "#160800";

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"smart" | "all">("smart");

  // Smart-tab AI recommendations — proxied through staff /api/ai-decisions
  // to backoffice. Scoped to the user's outlet on load.
  const [aiRecs, setAiRecs] = useState<PORecommendation[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [supplierPhone, setSupplierPhone] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  // `mode` distinguishes between Save-as-draft (saves PO, leaves status
  // DRAFT) and Send-via-WhatsApp (creates PO, transitions to
  // AWAITING_DELIVERY, opens supplier WhatsApp deeplink with the
  // pre-filled itemized order message).
  const [submitting, setSubmitting] = useState<null | "draft" | "send">(null);

  const [supplierPicker, setSupplierPicker] = useState(false);
  const [productPicker, setProductPicker] = useState(false);
  const [search, setSearch] = useState("");
  // Separate search state for the supplier picker so opening the
  // product picker doesn't carry over a leftover supplier search.
  const [supplierSearch, setSupplierSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Single fetch — `/api/suppliers/products` returns suppliers
        // with their products + packages + negotiated price already
        // joined. Mirrors the backoffice PO flow; no global product
        // catalog call needed.
        const s = await api<Supplier[]>("/api/suppliers/products").catch(
          () => [] as Supplier[],
        );
        if (cancelled) return;
        // Hide the "Ad-hoc Purchase" pseudo-supplier from the native
        // picker — that's a backoffice-only construct for one-off
        // purchases that don't have a real supplier record.
        setSuppliers(
          Array.isArray(s) ? s.filter((x) => x.name !== "Ad-hoc Purchase") : [],
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load AI recommendations on mount (and re-load on outlet change).
  // Filtered server-side to the current outlet so we don't surface
  // restock suggestions for an outlet the user can't write to.
  useEffect(() => {
    if (!session?.outletId) return;
    let cancelled = false;
    setAiLoading(true);
    fetchAIDecisions(session.outletId)
      .then((data) => {
        if (cancelled) return;
        setAiRecs(data.purchaseOrders ?? []);
      })
      .catch(() => {
        if (!cancelled) setAiRecs([]);
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.outletId]);

  const supplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );

  // Apply a Smart recommendation: jump to the All tab with the
  // supplier pre-selected and the cart pre-filled. User can still
  // tweak quantities / prices before sending.
  function applyRecommendation(rec: PORecommendation) {
    setSupplierId(rec.supplierId);
    const supp = suppliers.find((s) => s.id === rec.supplierId);
    setSupplierPhone(supp?.phone ?? null);
    setCart(
      rec.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        sku: "",
        unitLabel: it.packageLabel ?? it.packageName ?? it.baseUom,
        packageId: it.packageId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
    );
    setTab("all");
    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  }

  function addProduct(p: SupplierProduct) {
    // SupplierProduct already carries the supplier's package + price,
    // so a single line maps 1:1 — no defaults to pick, no zero-price
    // line items. Mirrors backoffice exactly.
    setCart((prev) => [
      ...prev,
      {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        unitLabel: p.packageLabel,
        packageId: p.packageId,
        quantity: 1,
        unitPrice: p.price,
      },
    ]);
    setProductPicker(false);
    setSearch("");
    Haptics.selectionAsync().catch(() => {});
  }

  function updateLine(idx: number, patch: Partial<CartLine>) {
    setCart((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  const canSubmit =
    !!supplierId &&
    !!session?.outletId &&
    cart.length > 0 &&
    cart.every((l) => l.quantity > 0 && l.unitPrice >= 0);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    [cart],
  );

  // Pre-formatted WhatsApp message — mirrors the backoffice template.
  function buildWhatsAppMessage() {
    const supp = suppliers.find((s) => s.id === supplierId);
    const today = new Date().toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    let msg = `📋 *Order from Celsius Coffee*\n`;
    msg += `Outlet: ${session?.outletName ?? "—"}\nDate: ${today}\n\n`;
    cart.forEach((line, i) => {
      msg += `${i + 1}. ${line.productName} — ${line.quantity} ${line.unitLabel}\n`;
    });
    if (deliveryDate)
      msg += `\nDelivery: ${new Date(deliveryDate).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })}`;
    if (notes) msg += `\nNotes: ${notes}`;
    msg += `\n\nTotal: RM ${total.toFixed(2)}`;
    msg += `\n\nThank you! 🙏`;
    return { msg, phone: supp?.phone ?? null };
  }

  async function submit(mode: "draft" | "send") {
    if (!canSubmit || !session?.outletId) return;
    setSubmitting(mode);
    try {
      const res = await createOrder({
        outletId: session.outletId,
        supplierId,
        notes: notes || undefined,
        deliveryDate: deliveryDate || undefined,
        items: cart.map((l) => ({
          productId: l.productId,
          productPackageId: l.packageId ?? undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});

      if (mode === "send") {
        // Transition to AWAITING_DELIVERY (stamps sentAt) and open the
        // supplier's WhatsApp chat with the pre-filled itemized message.
        await sendOrder(res.id).catch(() => {});
        const { msg, phone } = buildWhatsAppMessage();
        const text = encodeURIComponent(msg);
        const cleaned = phone?.replace(/\D/g, "");
        const url = cleaned
          ? `https://wa.me/${cleaned}?text=${text}`
          : `https://wa.me/?text=${text}`;
        Linking.openURL(url).catch(() => {});
      }

      router.replace(`/(staff)/orders/${res.id}` as never);
    } catch (e) {
      Alert.alert(
        "Couldn't create PO",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#C2452D" />
        </View>
      </Screen>
    );
  }

  // Picker is just the selected supplier's product list. Empty array
  // when no supplier is chosen (the picker can't be opened in that
  // state anyway — empty-state card disables the trigger).
  const pickerSource: SupplierProduct[] = supplier?.products ?? [];
  const filtered = search
    ? pickerSource.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()),
      )
    : pickerSource;

  return (
    <Screen edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="pt-3">
          <PageHeader
            title="New PO"
            subtitle={session?.outletName ?? "Your outlet"}
            back
          />
        </View>

        {/* Smart / All tabs */}
        <View className="mb-3 flex-row gap-2">
          {(["smart", "all"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 ${
                tab === t ? "bg-primary" : "bg-primary-50"
              }`}
            >
              <Text
                className={`text-xs font-body-bold capitalize ${
                  tab === t ? "text-white" : "text-primary"
                }`}
              >
                {t === "smart" ? "Smart" : "Manual"}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "smart" ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerClassName="pb-24"
          >
            <Text className="mb-2 text-xs font-body text-muted-fg">
              AI-ranked restock recommendations based on current stock levels
              and recent usage. Tap to pre-fill the cart.
            </Text>
            {aiLoading ? (
              <SkeletonList count={3} />
            ) : aiRecs.length === 0 ? (
              <View className="rounded-3xl border border-dashed border-border bg-surface px-4 py-8 items-center">
                <Sparkles color="#C2452D" size={28} />
                <Text className="mt-2 text-sm font-body-bold text-espresso">
                  Nothing to restock right now
                </Text>
                <Text className="mt-1 text-xs font-body text-muted-fg text-center">
                  Stock is healthy at your outlet — switch to Manual to
                  create a one-off PO.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {aiRecs.map((rec) => {
                  const urgencyTone =
                    rec.urgency === "critical"
                      ? "danger"
                      : rec.urgency === "low"
                        ? "warning"
                        : "brand";
                  const urgencyLabel =
                    rec.urgency === "critical"
                      ? "Critical"
                      : rec.urgency === "low"
                        ? "Low"
                        : "Restock";
                  return (
                    <Pressable
                      key={`${rec.supplierId}-${rec.outletId}`}
                      onPress={() => applyRecommendation(rec)}
                      className="rounded-3xl border border-border bg-surface px-4 py-3.5 active:bg-primary-50"
                    >
                      <View className="flex-row items-start justify-between gap-2">
                        <Text
                          className="flex-1 text-base font-body-bold text-espresso"
                          numberOfLines={1}
                        >
                          {rec.supplierName}
                        </Text>
                        <Pill label={urgencyLabel} tone={urgencyTone} />
                      </View>
                      <Text className="mt-0.5 text-xs font-body text-muted-fg">
                        {rec.items.length} item
                        {rec.items.length === 1 ? "" : "s"} ·{" "}
                        {rec.leadTimeDays > 0
                          ? `${rec.leadTimeDays}-day lead`
                          : "lead unknown"}
                      </Text>
                      <View className="mt-2 flex-row items-center justify-between">
                        <Text className="text-sm font-body-bold text-espresso tabular-nums">
                          RM {rec.totalAmount.toFixed(2)}
                        </Text>
                        <Text className="text-xs font-body-bold text-primary">
                          Tap to apply →
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          // pb-32 ≈ pinned bar height (h-14 + py-3 = 80px) + breathing room.
          // Anything larger leaves a visible dead zone above the bar.
          contentContainerClassName="pb-32"
          // flexGrow:1 lets the empty-state card stretch to fill the
          // viewport. Without it, ScrollView only grows to the size of
          // its content, leaving the bottom action bar floating over
          // whitespace when the cart has zero items.
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Supplier */}
          <Field label="Supplier">
            <Pressable
              onPress={() => setSupplierPicker(true)}
              className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
            >
              <Text
                className={`flex-1 text-base font-body ${
                  supplier ? "text-espresso" : "text-muted"
                }`}
                numberOfLines={1}
              >
                {supplier?.name ?? "Select supplier"}
              </Text>
              <ChevronDown color="#9CA3AF" size={20} />
            </Pressable>
          </Field>

          {/* Delivery date */}
          <Field label="Delivery date (optional)">
            <TextInput
              value={deliveryDate}
              onChangeText={setDeliveryDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
            />
          </Field>

          {/* Items */}
          <View className="mt-5 flex-row items-center justify-between">
            <Text className="text-xs font-body-semi uppercase tracking-wider text-muted">
              Items ({cart.length})
            </Text>
            <Pressable
              onPress={() => setProductPicker(true)}
              className="h-8 flex-row items-center gap-1 rounded-lg bg-primary px-3 active:opacity-90"
            >
              <Plus color="#FFFFFF" size={14} />
              <Text className="text-xs font-body-bold text-white">Add item</Text>
            </Pressable>
          </View>

          {cart.length === 0 ? (
            // Big tappable empty state — the whole card opens the picker
            // so the user doesn't have to find the tiny "Add item" pill
            // above. `flex-1` + ScrollView flexGrow:1 above stretches
            // this card to fill the viewport so the pinned action bar
            // doesn't float over a blank screen.
            <Pressable
              onPress={() => setProductPicker(true)}
              disabled={!supplierId}
              className={`mt-3 mb-4 flex-1 rounded-3xl border border-dashed border-border bg-surface items-center justify-center px-6 py-10 ${
                supplierId ? "active:bg-primary-50" : "opacity-60"
              }`}
            >
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary-50">
                <PackageIcon color="#C2452D" size={28} />
              </View>
              <Text className="mt-3 text-base font-body-bold text-espresso">
                {supplierId ? "Add your first item" : "Pick a supplier first"}
              </Text>
              <Text className="mt-1 px-4 text-center text-xs font-body text-muted-fg">
                {supplierId
                  ? pickerSource.length === 0
                    ? "This supplier has no products linked. Add some in backoffice → suppliers first."
                    : `Tap to browse ${pickerSource.length} item${pickerSource.length === 1 ? "" : "s"} from this supplier.`
                  : "Select a supplier above to start adding items."}
              </Text>
              {supplierId ? (
                <View className="mt-4 flex-row items-center gap-1.5 rounded-full bg-primary px-4 py-2">
                  <Plus color="#FFFFFF" size={14} />
                  <Text className="text-xs font-body-bold text-white">
                    Add item
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : (
            <View className="mt-3 gap-2">
              {cart.map((line, idx) => (
                <View
                  key={idx}
                  className="rounded-3xl border border-border bg-surface px-4 py-3"
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text
                        className="text-sm font-body-bold text-espresso"
                        numberOfLines={2}
                      >
                        {line.productName}
                      </Text>
                      <Text className="mt-0.5 text-xs font-body text-muted-fg">
                        {line.sku} · {line.unitLabel}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeLine(idx)}
                      hitSlop={8}
                      className="h-8 w-8 items-center justify-center rounded-full active:bg-danger/10"
                    >
                      <Trash2 color="#EF4444" size={16} />
                    </Pressable>
                  </View>
                  <View className="mt-3 flex-row items-center gap-3">
                    <View className="flex-1">
                      <Text className="mb-1 text-[10px] font-body-semi uppercase tracking-wide text-muted">
                        Qty
                      </Text>
                      <View className="h-11 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-2">
                        <Pressable
                          onPress={() =>
                            updateLine(idx, {
                              quantity: Math.max(0, line.quantity - 1),
                            })
                          }
                          className="h-8 w-8 items-center justify-center rounded-lg active:bg-primary-50"
                        >
                          <Minus color={iconColor} size={16} />
                        </Pressable>
                        <TextInput
                          value={String(line.quantity)}
                          onChangeText={(t) =>
                            updateLine(idx, {
                              quantity: Math.max(0, Number(t) || 0),
                            })
                          }
                          keyboardType="number-pad"
                          className="flex-1 text-center text-base font-body-bold text-espresso tabular-nums"
                        />
                        <Pressable
                          onPress={() =>
                            updateLine(idx, { quantity: line.quantity + 1 })
                          }
                          className="h-8 w-8 items-center justify-center rounded-lg active:bg-primary-50"
                        >
                          <Plus color={iconColor} size={16} />
                        </Pressable>
                      </View>
                    </View>
                    <View className="flex-1">
                      <Text className="mb-1 text-[10px] font-body-semi uppercase tracking-wide text-muted">
                        Unit price (RM)
                      </Text>
                      <TextInput
                        value={
                          line.unitPrice === 0 ? "" : String(line.unitPrice)
                        }
                        onChangeText={(t) =>
                          updateLine(idx, {
                            unitPrice: Math.max(0, Number(t) || 0),
                          })
                        }
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#9CA3AF"
                        className="h-11 rounded-2xl border border-border bg-surface px-3 text-base font-body-bold text-espresso text-right tabular-nums"
                      />
                    </View>
                  </View>
                  <View className="mt-2 flex-row items-center justify-between">
                    <Text className="text-xs font-body text-muted-fg">
                      Line total
                    </Text>
                    <Text className="text-sm font-body-bold text-espresso tabular-nums">
                      RM {(line.quantity * line.unitPrice).toFixed(2)}
                    </Text>
                  </View>
                </View>
              ))}
              <View className="mt-1 flex-row items-center justify-between rounded-3xl bg-primary-50 px-4 py-3">
                <Text className="text-sm font-body-bold text-espresso">
                  Total
                </Text>
                <Text className="text-lg font-body-bold text-primary tabular-nums">
                  RM {total.toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          {/* Notes — only relevant once there's something to note about.
              Hiding while empty also tightens the visual gap above the
              pinned action bar. */}
          {cart.length > 0 ? (
            <Field label="Notes (optional)">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. urgent — needed by morning shift"
                placeholderTextColor="#9CA3AF"
                multiline
                className="min-h-14 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
              />
            </Field>
          ) : null}
        </ScrollView>
        )}

        {/* Pinned action bar — only on Manual tab (Smart has no cart yet) */}
        {tab === "all" ? (
          <View
            style={{
              shadowColor: "#160800",
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
            }}
            className="absolute inset-x-0 bottom-0 bg-background px-4 pt-3 pb-3"
          >
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => submit("draft")}
                disabled={!canSubmit || !!submitting}
                className={`h-14 flex-1 items-center justify-center rounded-2xl border ${
                  canSubmit && !submitting
                    ? "border-primary active:bg-primary-50"
                    : "border-border opacity-50"
                }`}
              >
                {submitting === "draft" ? (
                  <ActivityIndicator color="#C2452D" />
                ) : (
                  <Text className="text-sm font-body-bold text-primary">
                    Save as draft
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => submit("send")}
                disabled={!canSubmit || !!submitting}
                className={`h-14 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl ${
                  canSubmit && !submitting
                    ? "bg-primary active:opacity-90"
                    : "bg-primary/40"
                }`}
              >
                {submitting === "send" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Send color="#FFFFFF" size={16} />
                    <Text className="text-sm font-body-bold text-white">
                      Send via WhatsApp
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Supplier picker sheet */}
      <Modal
        visible={supplierPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setSupplierPicker(false);
          setSupplierSearch("");
        }}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-peachi text-espresso">
              Pick supplier
            </Text>
            <Pressable
              onPress={() => {
                setSupplierPicker(false);
                setSupplierSearch("");
              }}
              className="px-2 py-1"
            >
              <XIcon color={iconColor} size={20} />
            </Pressable>
          </View>
          {/* Search bar — name OR phone match. 40+ active suppliers
              makes scrolling painful without this. */}
          <View className="px-4 pt-3">
            <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3">
              <Search color="#9CA3AF" size={18} />
              <TextInput
                value={supplierSearch}
                onChangeText={setSupplierSearch}
                placeholder="Search suppliers"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                className="h-12 flex-1 text-base font-body text-espresso"
              />
              {supplierSearch ? (
                <Pressable onPress={() => setSupplierSearch("")} hitSlop={8}>
                  <XIcon color="#9CA3AF" size={16} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView
            contentContainerClassName="px-4 py-3 gap-2"
            keyboardShouldPersistTaps="handled"
          >
            {(() => {
              const q = supplierSearch.trim().toLowerCase();
              const filteredSuppliers = q
                ? suppliers.filter(
                    (s) =>
                      s.name.toLowerCase().includes(q) ||
                      (s.phone ?? "").toLowerCase().includes(q),
                  )
                : suppliers;
              if (filteredSuppliers.length === 0) {
                return (
                  <View className="mt-10 items-center px-6">
                    <Text className="text-center text-sm font-body-bold text-espresso">
                      {q
                        ? "No suppliers match"
                        : "No active suppliers"}
                    </Text>
                    <Text className="mt-1 text-center text-xs font-body text-muted-fg">
                      {q
                        ? "Try a different name or phone fragment."
                        : "Add suppliers in backoffice → suppliers first."}
                    </Text>
                  </View>
                );
              }
              return filteredSuppliers.map((s) => {
                const count = s.products?.length ?? 0;
                const isSelected = s.id === supplierId;
                const isEmpty = count === 0;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      setSupplierId(s.id);
                      setSupplierPicker(false);
                      setSupplierSearch("");
                    }}
                    className={`flex-row items-center justify-between gap-3 rounded-2xl border px-4 py-3 active:bg-primary-50 ${
                      isSelected
                        ? "border-primary bg-primary-50"
                        : "border-border bg-surface"
                    } ${isEmpty ? "opacity-60" : ""}`}
                  >
                    <View className="flex-1">
                      <Text
                        className="text-base font-body-bold text-espresso"
                        numberOfLines={1}
                      >
                        {s.name}
                      </Text>
                      <Text className="mt-0.5 text-xs font-body text-muted-fg">
                        {count} item{count === 1 ? "" : "s"}
                        {s.phone ? ` · ${s.phone}` : ""}
                      </Text>
                    </View>
                    {isSelected ? (
                      <Check color="#C2452D" size={20} />
                    ) : null}
                  </Pressable>
                );
              });
            })()}
          </ScrollView>
        </View>
      </Modal>

      {/* Product picker sheet */}
      <Modal
        visible={productPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setProductPicker(false)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-peachi text-espresso">
              Add item
            </Text>
            <Pressable
              onPress={() => {
                setProductPicker(false);
                setSearch("");
              }}
              className="px-2 py-1"
            >
              <XIcon color={iconColor} size={20} />
            </Pressable>
          </View>
          <View className="px-4 pt-3">
            <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3">
              <Search color="#9CA3AF" size={18} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search products"
                placeholderTextColor="#9CA3AF"
                className="h-12 flex-1 text-base font-body text-espresso"
              />
            </View>
          </View>
          <ScrollView contentContainerClassName="px-4 py-3 gap-2">
            {filtered.length === 0 ? (
              <View className="mt-10 items-center px-6">
                <Text className="text-center text-sm font-body-bold text-espresso">
                  {search
                    ? "No products match your search"
                    : "This supplier has no products yet"}
                </Text>
                <Text className="mt-1 text-center text-xs font-body text-muted-fg">
                  {search
                    ? "Try a different keyword or SKU."
                    : "Add supplier-product mappings in backoffice → suppliers."}
                </Text>
              </View>
            ) : (
              // De-dupe by productId+packageId — an ADHOC supplier
              // expansion can produce multiple entries for the same
              // (product, package) tuple, and we don't want dupes in
              // the picker row list.
              filtered.map((p, idx) => (
                <Pressable
                  key={`${p.id}-${p.packageId ?? "base"}-${idx}`}
                  onPress={() => addProduct(p)}
                  className="rounded-2xl border border-border bg-surface px-4 py-3 active:bg-primary-50"
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <View className="flex-1">
                      <Text
                        className="text-sm font-body-bold text-espresso"
                        numberOfLines={1}
                      >
                        {p.name}
                      </Text>
                      <Text className="text-xs font-body text-muted-fg">
                        {p.sku} · {p.packageLabel}
                      </Text>
                    </View>
                    {p.price > 0 ? (
                      <Text className="text-sm font-body-bold text-primary tabular-nums">
                        RM {p.price.toFixed(2)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}
