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
import {
  createClaim,
  extractFromUrls,
  listSuppliers,
  uploadReceiptPhoto,
  type Supplier,
} from "../../../lib/claims";
import { useStaff } from "../../../lib/store";

type Step = "capture" | "form";

export default function NewClaim() {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useStaff((s) => s.session);

  const [step, setStep] = useState<Step>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractConfidence, setExtractConfidence] = useState<string | null>(
    null,
  );

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
      const photos = photoUrl ? [photoUrl] : [];
      if (photos.length === 0) throw new Error("Add at least one receipt photo.");

      return createClaim({
        outletId: session.outletId,
        supplierId: supplierId || undefined,
        supplierName: supplierName || null,
        claimedById: session.userId,
        amount: Number(amount),
        purchaseDate,
        photos,
        notes: notes || null,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      Alert.alert(
        "Claim submitted",
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
      <View className="flex-1 bg-background px-5 pt-10">
        <Text className="text-3xl font-display text-espresso">New claim</Text>
        <Text className="mt-2 text-sm font-body text-muted-fg">
          Snap the receipt and we'll fill in the details.
        </Text>

        <Pressable
          onPress={() => setCameraOpen(true)}
          className="mt-8 items-center justify-center rounded-3xl border-2 border-dashed border-primary/40 bg-primary-50 py-12 active:opacity-80"
        >
          <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Camera color="#A2492C" size={32} />
          </View>
          <Text className="mt-4 text-base font-body-bold text-primary">
            Take photo of receipt
          </Text>
          <Text className="mt-1 text-xs font-body text-muted-fg">
            Tap to open camera
          </Text>
        </Pressable>

        <Pressable
          onPress={startManualEntry}
          className="mt-4 h-14 items-center justify-center rounded-2xl border border-border bg-surface active:bg-primary-50"
        >
          <Text className="text-sm font-body-semi text-espresso">
            Enter manually without photo
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-5 pt-6 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <PhotoStatus
          hasPhoto={!!photoUri}
          uploadError={uploadError}
          extracting={extracting}
          confidence={extractConfidence}
          onRetake={() => setCameraOpen(true)}
        />

        <Field label="Outlet">
          <View className="h-14 justify-center rounded-2xl bg-primary-50 px-4">
            <Text className="text-base font-body-semi text-espresso">
              {session?.outletName ?? "—"}
            </Text>
          </View>
        </Field>

        <Field label="Supplier">
          <Pressable
            onPress={() => setSupplierPickerOpen(true)}
            className="h-14 flex-row items-center justify-between rounded-2xl border border-border bg-surface px-4 active:bg-primary-50"
          >
            <Text
              className={`flex-1 text-base font-body ${supplierName ? "text-espresso" : "text-muted"}`}
              numberOfLines={1}
            >
              {supplierName || "Select supplier"}
            </Text>
            <ChevronDown color="#6B6B6B" size={20} />
          </Pressable>
        </Field>

        <Field label="Amount (RM)">
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="#9B9B9B"
            keyboardType="decimal-pad"
            className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body-semi text-espresso"
          />
        </Field>

        <Field label="Purchase date">
          <TextInput
            value={purchaseDate}
            onChangeText={setPurchaseDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9B9B9B"
            autoCapitalize="none"
            className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
          />
        </Field>

        <Field label="Notes (optional)">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. urgent restock"
            placeholderTextColor="#9B9B9B"
            multiline
            className="min-h-14 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
          />
        </Field>

        {formError ? (
          <Text className="mt-4 text-sm text-danger">{formError}</Text>
        ) : null}

        <Pressable
          onPress={() => {
            setFormError(null);
            submitMutation.mutate();
          }}
          disabled={submitMutation.isPending}
          className="mt-6 h-16 flex-row items-center justify-center rounded-2xl bg-primary active:opacity-80 disabled:opacity-50"
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-body-bold text-white">
              Submit claim
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
      <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
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
  if (!hasPhoto) {
    return (
      <View className="flex-row items-center rounded-2xl border border-border bg-surface p-4">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-muted/10">
          <ImageIcon color="#6B6B6B" size={20} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-sm font-body-semi text-espresso">
            No photo attached
          </Text>
          <Text className="mt-0.5 text-xs font-body text-muted-fg">
            Add one for faster approval
          </Text>
        </View>
        <Pressable
          onPress={onRetake}
          className="h-10 items-center justify-center rounded-xl bg-primary px-3 active:opacity-80"
        >
          <Text className="text-xs font-body-bold text-white">Add photo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <View className="flex-row items-center">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
          {extracting ? (
            <Loader color="#A2492C" size={20} />
          ) : uploadError ? (
            <ImageIcon color="#B91C1C" size={20} />
          ) : (
            <Check color="#A2492C" size={20} />
          )}
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-sm font-body-semi text-espresso">
            {uploadError
              ? "Upload failed"
              : extracting
                ? "Reading receipt…"
                : "Receipt attached"}
          </Text>
          {uploadError ? (
            <Text className="mt-0.5 text-xs text-danger" numberOfLines={2}>
              {uploadError}
            </Text>
          ) : extracting ? (
            <View className="mt-0.5 flex-row items-center gap-1">
              <Sparkles color="#A2492C" size={12} />
              <Text className="text-xs font-body text-muted-fg">
                Filling in details automatically
              </Text>
            </View>
          ) : confidence ? (
            <Text className="mt-0.5 text-xs font-body text-muted-fg">
              Details prefilled ({confidence} confidence)
            </Text>
          ) : (
            <Text className="mt-0.5 text-xs font-body text-muted-fg">
              Review the details below
            </Text>
          )}
        </View>
        <Pressable
          onPress={onRetake}
          className="h-10 items-center justify-center rounded-xl bg-primary-50 px-3 active:opacity-80"
        >
          <Text className="text-xs font-body-bold text-primary">Retake</Text>
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
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
          <Text className="text-xl font-display text-espresso">Suppliers</Text>
          <Pressable onPress={onClose} className="px-2 py-1">
            <Text className="text-sm font-body-bold text-primary">Close</Text>
          </Pressable>
        </View>
        <View className="px-5 pt-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search suppliers"
            placeholderTextColor="#9B9B9B"
            className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
          />
        </View>
        <ScrollView className="flex-1" contentContainerClassName="px-5 py-4">
          {filtered.length === 0 ? (
            <Text className="mt-8 text-center text-sm text-muted-fg">
              No suppliers match "{query}"
            </Text>
          ) : (
            filtered.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => onSelect(s)}
                className={`mb-2 h-14 flex-row items-center justify-between rounded-2xl border px-4 active:bg-primary-50 ${
                  s.id === selectedId
                    ? "border-primary bg-primary-50"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className="flex-1 text-base font-body-semi text-espresso"
                  numberOfLines={1}
                >
                  {s.name}
                </Text>
                {s.id === selectedId ? (
                  <Check color="#A2492C" size={20} />
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
