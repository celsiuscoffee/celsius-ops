import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Camera,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader,
  Sparkles,
} from "lucide-react-native";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  createClaim,
  extractFromUrls,
  listSuppliers,
  uploadReceiptPhoto,
  type Supplier,
} from "../../../lib/claims";
import { useStaff } from "../../../lib/store";
import { useCelsius } from "../../../lib/celsius-ui";

type Step = "capture" | "form";

export default function NewClaim() {
  const C = useCelsius().color;
  const router = useRouter();
  const qc = useQueryClient();
  const session = useStaff((s) => s.session);
  // Payment Request flow is manager-only, matches the server-side
  // 403 guard on /api/claims POST. Hiding the toggle for non-managers
  // keeps the UI honest.
  const canRequestVendorPayment =
    session?.role === "OWNER" ||
    session?.role === "ADMIN" ||
    session?.role === "MANAGER";

  const [step, setStep] = useState<Step>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractConfidence, setExtractConfidence] = useState<string | null>(
    null,
  );

  // CLAIM = "I paid, reimburse me" | REQUEST = "Pay this vendor for me"
  const [flow, setFlow] = useState<"CLAIM" | "REQUEST">("CLAIM");
  const [vendorName, setVendorName] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data: suppliersData } = useQuery({
    queryKey: ["claim-suppliers"],
    queryFn: listSuppliers,
  });
  const suppliers = suppliersData ?? [];

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!session?.outletId) throw new Error("No outlet on your account.");
      if (!session?.userId) throw new Error("Sign in again to submit.");
      if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        throw new Error("Enter a valid amount.");
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) ||
        Number.isNaN(new Date(`${purchaseDate}T00:00:00`).getTime())
      ) {
        throw new Error("Enter a valid purchase date (YYYY-MM-DD).");
      }
      if (flow === "REQUEST" && !vendorName.trim()) {
        throw new Error("Enter the vendor's name.");
      }
      const photos = photoUrl ? [photoUrl] : [];
      if (photos.length === 0) throw new Error("Add at least one receipt photo.");

      return createClaim({
        outletId: session.outletId,
        supplierId: supplierId || undefined,
        supplierName: supplierName || null,
        claimedById: flow === "CLAIM" ? session.userId : undefined,
        amount: Number(amount),
        purchaseDate,
        photos,
        notes: notes || null,
        flow,
        vendorName: flow === "REQUEST" ? vendorName.trim() : undefined,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      Alert.alert(
        flow === "CLAIM" ? "Claim submitted" : "Payment request submitted",
        `Order ${res.order.orderNumber}\nInvoice ${res.invoice.invoiceNumber}`,
        [{ text: "Done", onPress: () => router.back() }],
      );
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Submit failed");
    },
  });

  async function handleCapture(photo: CapturedPhoto) {
    setCameraOpen(false);
    setPhotoUri(photo.uri);
    setUploadError(null);
    setStep("form");
    try {
      const url = await uploadReceiptPhoto(photo);
      setPhotoUrl(url);
      runExtraction(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function runExtraction(url: string) {
    setExtracting(true);
    try {
      const data = await extractFromUrls([url]);
      if (data.amount && !amount) setAmount(String(data.amount));
      if (data.issueDate) setPurchaseDate(data.issueDate);
      if (data.supplierName && !supplierName) {
        setSupplierName(data.supplierName);
        const match = matchSupplier(suppliers, data.supplierName);
        if (match) {
          setSupplierId(match.id);
          setSupplierName(match.name);
        }
      }
      if (data.confidence) setExtractConfidence(data.confidence);
    } catch {
      // best-effort; user can still enter manually
    } finally {
      setExtracting(false);
    }
  }

  function startManualEntry() {
    setStep("form");
    setPhotoUri(null);
    setPhotoUrl(null);
  }

  if (cameraOpen) {
    return (
      <Modal animationType="slide" presentationStyle="fullScreen">
        <ReceiptCapture
          onCapture={handleCapture}
          onCancel={() => setCameraOpen(false)}
        />
      </Modal>
    );
  }

  if (step === "capture") {
    return (
      <Screen edges={["top", "left", "right"]}>
        <PageHeader
          title="New claim"
          subtitle="Snap the receipt and we'll fill in the details."
          back
        />

        <Pressable
          onPress={() => setCameraOpen(true)}
          className="mt-6 items-center justify-center rounded-2xl border-2 border-dashed border-line-2 bg-sunken py-12 active:opacity-80"
        >
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-sunken">
            <Camera color={C["text-2"]} size={32} />
          </View>
          <Text className="mt-4 text-base font-body-bold text-text">
            Take photo of receipt
          </Text>
          <Text className="mt-1 text-xs font-body text-text-2">
            Tap to open camera
          </Text>
        </Pressable>

        <Pressable
          onPress={startManualEntry}
          className="mt-4 h-14 items-center justify-center rounded-2xl border border-line bg-surface active:bg-sunken"
        >
          <Text className="text-base font-body-semi text-text">
            Enter manually without photo
          </Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen edges={["top", "left", "right"]}>
        {/* Sticky header */}
                  <PageHeader
            title="New claim"
            subtitle="Review and submit for reimbursement."
            back
          />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled"
        >
          <PhotoStatus
            hasPhoto={!!photoUri}
            uploadError={uploadError}
            extracting={extracting}
            confidence={extractConfidence}
            onRetake={() => setCameraOpen(true)}
          />

        {/* Flow toggle, only shown to managers. Regular staff can
            only submit reimbursement claims (the legacy default). */}
        {canRequestVendorPayment ? (
          <>
            <View className="mt-4 flex-row gap-2 rounded-2xl border border-line bg-surface p-1.5">
              <Pressable
                onPress={() => setFlow("CLAIM")}
                className={`flex-1 items-center rounded-xl py-2.5 active:opacity-80 ${
                  flow === "CLAIM" ? "bg-ink" : ""
                }`}
              >
                <Text
                  className={`text-sm font-body-bold ${
                    flow === "CLAIM" ? "text-on-ink" : "text-text-2"
                  }`}
                >
                  Reimburse me
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFlow("REQUEST")}
                className={`flex-1 items-center rounded-xl py-2.5 active:opacity-80 ${
                  flow === "REQUEST" ? "bg-ink" : ""
                }`}
              >
                <Text
                  className={`text-sm font-body-bold ${
                    flow === "REQUEST" ? "text-on-ink" : "text-text-2"
                  }`}
                >
                  Pay vendor
                </Text>
              </Pressable>
            </View>
            <Text className="mt-1.5 text-xs font-body text-text-2">
              {flow === "CLAIM"
                ? "You paid out-of-pocket, finance reimburses you."
                : "Finance pays the vendor directly, no out-of-pocket."}
            </Text>
          </>
        ) : null}

        <Field label="Outlet">
          <View className="h-14 justify-center rounded-2xl bg-sunken px-4">
            <Text className="text-base font-body-semi text-text">
              {session?.outletName ?? "-"}
            </Text>
          </View>
        </Field>

        {flow === "REQUEST" ? (
          <Field label="Vendor name">
            <TextInput
              value={vendorName}
              onChangeText={setVendorName}
              placeholder="e.g. ABC Plumbing Services"
              placeholderTextColor={C["text-3"]}
              className="h-14 rounded-2xl border border-line bg-surface px-4 text-base font-body text-text"
            />
          </Field>
        ) : null}

        <Field
          label={
            flow === "REQUEST" ? "Linked supplier (optional)" : "Supplier"
          }
        >
          <Pressable
            onPress={() => setSupplierPickerOpen(true)}
            className="h-14 flex-row items-center justify-between rounded-2xl border border-line bg-surface px-4 active:bg-sunken"
          >
            <Text
              className={`flex-1 text-base font-body ${supplierName ? "text-text" : "text-text-3"}`}
              numberOfLines={1}
            >
              {supplierName ||
                (flow === "REQUEST" ? "None (one-off vendor)" : "Select supplier")}
            </Text>
            <ChevronDown color={C["text-3"]} size={20} />
          </Pressable>
        </Field>

        <Field label="Amount (RM)">
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C["text-3"]}
            keyboardType="decimal-pad"
            className="h-14 rounded-2xl border border-line bg-surface px-4 text-base font-body-semi text-text"
          />
        </Field>

        <Field label="Purchase date">
          <TextInput
            value={purchaseDate}
            onChangeText={setPurchaseDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C["text-3"]}
            autoCapitalize="none"
            className="h-14 rounded-2xl border border-line bg-surface px-4 text-base font-body text-text"
          />
        </Field>

        <Field label="Notes (optional)">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. urgent restock"
            placeholderTextColor={C["text-3"]}
            multiline
            className="min-h-14 rounded-2xl border border-line bg-surface px-4 py-3 text-base font-body text-text"
          />
        </Field>

        {formError ? (
          <Text className="mt-4 text-sm text-danger-text">{formError}</Text>
        ) : null}

        <Pressable
          onPress={() => {
            setFormError(null);
            submitMutation.mutate();
          }}
          disabled={submitMutation.isPending}
          className="mt-6 h-16 flex-row items-center justify-center rounded-2xl bg-ink active:opacity-80 disabled:opacity-50"
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color={C["on-ink"]} />
          ) : (
            <Text className="text-base font-body-bold text-on-ink">
              {flow === "CLAIM" ? "Submit claim" : "Submit payment request"}
            </Text>
          )}
        </Pressable>
        </ScrollView>

        <SupplierPicker
          open={supplierPickerOpen}
          suppliers={suppliers}
          selectedId={supplierId}
          onClose={() => setSupplierPickerOpen(false)}
          onSelect={(s) => {
            setSupplierId(s.id);
            setSupplierName(s.name);
            setSupplierPickerOpen(false);
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-5">
      <Text className="mb-2 text-sm font-body-semi text-text-2">
        {label}
      </Text>
      {children}
    </View>
  );
}

function PhotoStatus({
  hasPhoto,
  uploadError,
  extracting,
  confidence,
  onRetake,
}: {
  hasPhoto: boolean;
  uploadError: string | null;
  extracting: boolean;
  confidence: string | null;
  onRetake: () => void;
}) {
  const C = useCelsius().color;
  if (!hasPhoto) {
    return (
      <View className="flex-row items-center rounded-2xl border border-line bg-surface p-4">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-sunken">
          <ImageIcon color={C["text-3"]} size={20} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base font-body-semi text-text">
            No photo attached
          </Text>
          <Text className="mt-0.5 text-xs font-body text-text-2">
            Add one for faster approval
          </Text>
        </View>
        <Pressable
          onPress={onRetake}
          className="h-11 items-center justify-center rounded-xl bg-ink px-3 active:opacity-80"
        >
          <Text className="text-xs font-body-bold text-on-ink">Add photo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-line bg-surface p-4">
      <View className="flex-row items-center">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-sunken">
          {extracting ? (
            <Loader color={C["text-2"]} size={20} />
          ) : uploadError ? (
            <ImageIcon color={C.danger} size={20} />
          ) : (
            <Check color={C["text-2"]} size={20} />
          )}
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base font-body-semi text-text">
            {uploadError
              ? "Upload failed"
              : extracting
                ? "Reading receipt…"
                : "Receipt attached"}
          </Text>
          {uploadError ? (
            <Text className="mt-0.5 text-xs text-danger-text" numberOfLines={2}>
              {uploadError}
            </Text>
          ) : extracting ? (
            <View className="mt-0.5 flex-row items-center gap-1">
              <Sparkles color={C["text-2"]} size={12} />
              <Text className="text-xs font-body text-text-2">
                Filling in details automatically
              </Text>
            </View>
          ) : confidence ? (
            <Text className="mt-0.5 text-xs font-body text-text-2">
              Details prefilled ({confidence} confidence)
            </Text>
          ) : (
            <Text className="mt-0.5 text-xs font-body text-text-2">
              Review the details below
            </Text>
          )}
        </View>
        <Pressable
          onPress={onRetake}
          className="h-11 items-center justify-center rounded-xl bg-sunken px-3 active:opacity-80"
        >
          <Text className="text-xs font-body-bold text-text">Retake</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SupplierPicker({
  open,
  suppliers,
  selectedId,
  onClose,
  onSelect,
}: {
  open: boolean;
  suppliers: Supplier[];
  selectedId: string;
  onClose: () => void;
  onSelect: (s: Supplier) => void;
}) {
  const C = useCelsius().color;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, query]);

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-bg">
        <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
          <Text className="text-xl font-display text-text">Suppliers</Text>
          <Pressable onPress={onClose} className="min-h-11 justify-center px-3">
            <Text className="text-sm font-body-bold text-text">Close</Text>
          </Pressable>
        </View>
        <View className="px-5 pt-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search suppliers"
            placeholderTextColor={C["text-3"]}
            className="h-14 rounded-2xl border border-line bg-surface px-4 text-base font-body text-text"
          />
        </View>
        <ScrollView className="flex-1" contentContainerClassName="px-5 py-4"
      showsVerticalScrollIndicator={false}
    >
          {filtered.length === 0 ? (
            <Text className="mt-8 text-center text-sm text-text-2">
              No suppliers match "{query}"
            </Text>
          ) : (
            filtered.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => onSelect(s)}
                className={`mb-2 h-14 flex-row items-center justify-between rounded-2xl border px-4 active:bg-sunken ${
                  s.id === selectedId
                    ? "border-ink bg-sunken"
                    : "border-line bg-surface"
                }`}
              >
                <Text
                  className="flex-1 text-base font-body-semi text-text"
                  numberOfLines={1}
                >
                  {s.name}
                </Text>
                {s.id === selectedId ? (
                  <Check color={C["text-2"]} size={20} />
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function matchSupplier(
  suppliers: Supplier[],
  aiName: string,
): Supplier | null {
  const target = aiName.toLowerCase();
  const exact = suppliers.find(
    (s) =>
      s.name.toLowerCase().includes(target) ||
      target.includes(s.name.toLowerCase()),
  );
  if (exact) return exact;
  const aiWords = target.split(/\s+/).filter((w) => w.length > 2);
  return (
    suppliers.find((s) => {
      const sWords = s.name
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const overlap = aiWords.filter((w) =>
        sWords.some((sw) => sw.includes(w) || w.includes(sw)),
      );
      return (
        overlap.length >=
        Math.max(1, Math.min(aiWords.length, sWords.length) * 0.5)
      );
    }) ?? null
  );
}
