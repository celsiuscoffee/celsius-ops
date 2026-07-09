import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Camera,
  FileText,
  MessageCircle,
  Paperclip,
  X as XIcon,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Pill } from "../../../components/ui";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import {
  attachInvoice,
  buildPopMessage,
  fetchPopShortlink,
  markPopSent,
  getInvoice,
} from "../../../lib/ops/invoices";
import { uploadPhoto } from "../../../lib/upload";

type Invoice = {
  id: string;
  invoiceNumber: string;
  amount: number | string;
  amountPaid?: number | string | null;
  depositAmount?: number | string | null;
  depositPercent?: number | null;
  depositRef?: string | null;
  paymentRef?: string | null;
  popShortLink?: string | null;
  popSentAt?: string | null;
  status: string;
  paymentType?: string | null;
  dueDate: string | null;
  issueDate?: string | null;
  paidAt: string | null;
  createdAt: string;
  photos: string[];
  notes?: string | null;
  supplier?: { id: string; name: string; phone?: string } | null;
  order?: {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number | string;
    outlet?: { name: string; code: string } | null;
  } | null;
};

const STATUS_TONE: Record<
  string,
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

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [attachOpen, setAttachOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sendingPop, setSendingPop] = useState(false);

  // Open WhatsApp with a status-aware Proof of Payment message.
  // - If the invoice already has a stored popShortLink, reuse it.
  // - Otherwise mint a fresh shortlink via the backoffice proxy.
  // - Fall back to the latest photo URL if shortlink minting fails
  //   (supplier still sees a working receipt link).
  async function sendPop() {
    if (!invoice) return;
    setSendingPop(true);
    try {
      let receiptUrl = invoice.popShortLink ?? null;
      if (!receiptUrl) {
        try {
          const r = await fetchPopShortlink(invoice.id);
          receiptUrl = r.shortLink;
          setInvoice((prev) =>
            prev ? { ...prev, popShortLink: r.shortLink } : prev,
          );
        } catch {
          // ignore, falls through to the photo fallback
        }
      }
      if (!receiptUrl && invoice.photos.length > 0) {
        receiptUrl = invoice.photos[invoice.photos.length - 1];
      }
      if (!receiptUrl) {
        Alert.alert(
          "No receipt available",
          "Snap a payment receipt photo first.",
        );
        return;
      }
      const msg = buildPopMessage(
        {
          invoiceNumber: invoice.invoiceNumber,
          amount: Number(invoice.amount ?? 0),
          amountPaid:
            invoice.amountPaid != null ? Number(invoice.amountPaid) : 0,
          depositAmount:
            invoice.depositAmount != null
              ? Number(invoice.depositAmount)
              : null,
          depositPercent: invoice.depositPercent ?? null,
          depositRef: invoice.depositRef ?? null,
          paymentRef: invoice.paymentRef ?? null,
          dueDate: invoice.dueDate,
          status: invoice.status,
        },
        receiptUrl,
      );
      const text = encodeURIComponent(msg);
      const phone = invoice.supplier?.phone?.replace(/\D/g, "") ?? "";
      const url = phone
        ? `https://wa.me/${phone}?text=${text}`
        : `https://wa.me/?text=${text}`;
      // Only mark the POP as sent once WhatsApp actually opens. If the
      // deeplink fails (WhatsApp not installed), stamping popSentAt would
      // wrongly flag the invoice as "POP sent" forever.
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(
          "Couldn't open WhatsApp",
          "Install WhatsApp or send the POP manually.",
        );
        return;
      }
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      // Stamp popSentAt on the server so the list shows a "POP sent"
      // pill on this row after returning. The WhatsApp open already
      // succeeded so a failed stamp is cosmetic only.
      const optimisticTs = new Date().toISOString();
      setInvoice((prev) =>
        prev ? { ...prev, popSentAt: optimisticTs } : prev,
      );
      markPopSent(invoice.id).catch(() => {});
    } finally {
      setSendingPop(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const data = await getInvoice(id);
      setInvoice(data as unknown as Invoice);
    } catch (e) {
      Alert.alert(
        "Couldn't load invoice",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#C2452D" />
        </View>
      </Screen>
    );
  }

  if (!invoice) {
    return (
      <Screen>
        <PageHeader title="Invoice" back />
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm font-body text-muted-fg">Not found</Text>
        </View>
      </Screen>
    );
  }

  const amount = Number(invoice.amount ?? 0);
  const tone = STATUS_TONE[invoice.status] ?? {
    label: invoice.status,
    tone: "muted" as const,
  };
  const isPlaceholder =
    invoice.invoiceNumber.startsWith("INV-") &&
    invoice.dueDate == null &&
    invoice.status === "PENDING";

  return (
    <Screen
      edges={
        isPlaceholder ||
        invoice.status === "PAID" ||
        invoice.status === "DEPOSIT_PAID" ||
        invoice.status === "PARTIALLY_PAID"
          ? ["top", "left", "right"]
          : undefined
      }
    >
      <PageHeader
          title={isPlaceholder ? "Attach invoice" : invoice.invoiceNumber}
          subtitle={invoice.supplier?.name ?? "Invoice"}
          back
        />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
      >
        {/* Summary card */}
        <View className="rounded-3xl border border-border bg-surface px-4 py-3.5">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-xs font-body-bold uppercase tracking-wider text-muted">
                Amount
              </Text>
              <Text className="mt-1 text-2xl font-body-bold text-espresso tabular-nums">
                RM {amount.toFixed(2)}
              </Text>
            </View>
            <Pill label={tone.label} tone={tone.tone} />
          </View>
          {invoice.dueDate ? (
            <View className="mt-3 flex-row items-center justify-between border-t border-border pt-3">
              <Text className="text-xs font-body text-muted-fg">Due</Text>
              <Text className="text-base font-body-bold text-espresso">
                {new Date(invoice.dueDate).toLocaleDateString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>
          ) : null}
          {invoice.paidAt ? (
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xs font-body text-muted-fg">Paid</Text>
              <Text className="text-sm font-body-bold text-success">
                {new Date(invoice.paidAt).toLocaleDateString([], {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>
          ) : null}
        </View>

        {/* PO link */}
        {invoice.order ? (
          <View className="mt-3 rounded-3xl border border-border bg-surface px-4 py-3.5">
            <Text className="text-xs font-body-bold uppercase tracking-wider text-muted">
              Purchase order
            </Text>
            <Text className="mt-1 text-base font-body-bold text-espresso">
              {invoice.order.orderNumber}
            </Text>
            <Text className="text-xs font-body text-muted-fg">
              {invoice.order.outlet?.name} · {invoice.order.status}
            </Text>
          </View>
        ) : null}

        {/* Photos */}
        {invoice.photos && invoice.photos.length > 0 ? (
          <>
            <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
              Photos ({invoice.photos.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
      showsVerticalScrollIndicator={false}
    >
              {invoice.photos.map((url) => (
                <Image
                  key={url}
                  source={{ uri: url }}
                  style={{
                    width: 160,
                    height: 160,
                    borderRadius: 16,
                  }}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Notes */}
        {invoice.notes ? (
          <>
            <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
              Notes
            </Text>
            <View className="rounded-3xl border border-border bg-surface px-4 py-3">
              <Text className="text-sm font-body text-espresso">
                {invoice.notes}
              </Text>
            </View>
          </>
        ) : null}

        {/* GRNI explainer */}
        {isPlaceholder ? (
          <View className="mt-5 rounded-3xl border border-amber-500/30 bg-amber-50 px-4 py-3.5">
            <View className="flex-row items-center gap-2">
              <FileText color="#D97706" size={18} />
              <Text className="text-sm font-body-bold text-amber-700">
                Goods received, waiting for invoice
              </Text>
            </View>
            <Text className="mt-2 text-xs font-body text-amber-700/80">
              This is an auto-created placeholder from a receiving. Tap
              "Attach invoice" below to record the supplier's invoice
              number, due date, and snap a photo.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned action, placeholder gets Attach, paid invoices get
          Send POP via WhatsApp. PARTIALLY_PAID / DEPOSIT_PAID / PAID
          all trigger the POP flow with a status-aware message. */}
      {!isPlaceholder &&
      (invoice.status === "PAID" ||
        invoice.status === "DEPOSIT_PAID" ||
        invoice.status === "PARTIALLY_PAID") ? (
        <View
          style={{
            paddingBottom: 12,
            shadowColor: "#160800",
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
          }}
          className="absolute inset-x-0 bottom-0 bg-background px-4 pt-3 pb-3"
        >
          <Pressable
            onPress={sendPop}
            disabled={sendingPop}
            className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl ${
              sendingPop ? "bg-primary/50" : "bg-primary active:opacity-90"
            }`}
          >
            {sendingPop ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <MessageCircle color="#FFFFFF" size={18} />
                <Text className="text-base font-body-bold text-white">
                  Send POP via WhatsApp
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {isPlaceholder ? (
        <View
          style={{
            paddingBottom: 12,
            shadowColor: "#160800",
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
          }}
          className="absolute inset-x-0 bottom-0 bg-background px-4 pt-3 pb-3"
        >
          <Pressable
            onPress={() => setAttachOpen(true)}
            className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-90"
          >
            <Paperclip color="#FFFFFF" size={18} />
            <Text className="text-base font-body-bold text-white">
              Attach invoice
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Attach sheet */}
      <AttachSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onOpenCamera={() => setCameraOpen(true)}
        defaultAmount={amount}
        onSubmit={async (input) => {
          try {
            await attachInvoice(id, input);
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
            setAttachOpen(false);
            load();
          } catch (e) {
            Alert.alert(
              "Couldn't attach",
              e instanceof Error ? e.message : "Try again.",
            );
          }
        }}
        existingPhotos={invoice.photos ?? []}
      />

      {/* Camera */}
      {cameraOpen ? (
        <Modal animationType="slide" presentationStyle="fullScreen">
          <ReceiptCapture
            onCapture={async (photo: CapturedPhoto) => {
              setCameraOpen(false);
              try {
                const url = await uploadPhoto(photo);
                // Append to existing photos. We re-fetch after attach
                // so this is just for the sheet's preview.
                setInvoice((prev) =>
                  prev ? { ...prev, photos: [...prev.photos, url] } : prev,
                );
              } catch (e) {
                Alert.alert(
                  "Upload failed",
                  e instanceof Error ? e.message : "Try again.",
                );
              }
            }}
            onCancel={() => setCameraOpen(false)}
          />
        </Modal>
      ) : null}
    </Screen>
  );
}

function AttachSheet({
  open,
  onClose,
  onOpenCamera,
  onSubmit,
  defaultAmount,
  existingPhotos,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCamera: () => void;
  onSubmit: (input: {
    invoiceNumber: string;
    dueDate: string;
    amount?: number;
    photos?: string[];
  }) => Promise<void>;
  defaultAmount: number;
  existingPhotos: string[];
}) {
  const [invNum, setInvNum] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState(String(defaultAmount.toFixed(2)));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setInvNum("");
      setDueDate("");
      setAmount(String(defaultAmount.toFixed(2)));
      setSubmitting(false);
    }
  }, [open, defaultAmount]);

  const canSubmit =
    invNum.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dueDate);

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Text className="text-base font-display text-espresso">
              Attach invoice
            </Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <XIcon color="#9CA3AF" size={20} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerClassName="px-5 py-4"
            keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
            <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Invoice number
            </Text>
            <TextInput
              value={invNum}
              onChangeText={setInvNum}
              placeholder="INV-12345"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="characters"
              className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
            />

            <Text className="mt-4 mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Due date
            </Text>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
            />

            <Text className="mt-4 mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Amount (RM)
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body-bold text-espresso tabular-nums"
            />

            <Text className="mt-4 mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Photos
            </Text>
            <View className="flex-row gap-2 flex-wrap">
              {existingPhotos.map((url) => (
                <Image
                  key={url}
                  source={{ uri: url }}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 12,
                  }}
                />
              ))}
              <Pressable
                onPress={onOpenCamera}
                className="h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary-50 active:opacity-80"
              >
                <Camera color="#C2452D" size={20} />
              </Pressable>
            </View>
          </ScrollView>
          <View className="border-t border-border p-4">
            <Pressable
              onPress={async () => {
                if (!canSubmit || submitting) return;
                setSubmitting(true);
                try {
                  await onSubmit({
                    invoiceNumber: invNum.trim(),
                    dueDate,
                    amount: Number(amount) || undefined,
                    photos:
                      existingPhotos.length > 0 ? existingPhotos : undefined,
                  });
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={!canSubmit || submitting}
              className={`h-14 items-center justify-center rounded-2xl ${
                canSubmit && !submitting
                  ? "bg-primary active:opacity-90"
                  : "bg-primary/40"
              }`}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-base font-body-bold text-white">
                  Attach
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
