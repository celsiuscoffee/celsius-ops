import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Minus,
  Star,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react-native";
import {
  completeAudit,
  getAudit,
  updateAuditItem,
  type AuditDetail,
  type AuditItem,
} from "../../../lib/ops/audits";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import { uploadPhoto } from "../../../lib/upload";

export default function AuditDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [audit, setAudit] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeStep, setCompleteStep] = useState(false);
  const [overallNotes, setOverallNotes] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getAudit(id);
      setAudit(data);
      setError(null);
      // Position cursor on first un-rated item
      const idx = data.items.findIndex((i) => i.rating === null);
      if (idx !== -1) setCursor(idx);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const items = audit?.items ?? [];
  const total = items.length;
  const rated = items.filter((i) => i.rating !== null).length;
  const pct = total > 0 ? Math.round((rated / total) * 100) : 0;
  const item: AuditItem | undefined = items[cursor];
  const isCompleted = audit?.status === "COMPLETED";

  const setRating = useCallback(
    async (rating: number) => {
      if (!audit || !item || isCompleted) return;
      // Optimistic
      setAudit((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === item.id ? { ...i, rating } : i,
              ),
            }
          : prev,
      );
      Haptics.selectionAsync().catch(() => {});
      try {
        await updateAuditItem(audit.id, item.id, { rating });
      } catch (e) {
        Alert.alert("Save failed", e instanceof Error ? e.message : "Try again.");
        load();
        return;
      }
      // Auto-advance to next unrated item
      const nextIdx = items.findIndex(
        (i, idx) => idx > cursor && i.rating === null,
      );
      if (nextIdx !== -1) {
        setTimeout(() => setCursor(nextIdx), 250);
      }
    },
    [audit, item, isCompleted, items, cursor, load],
  );

  const saveNote = useCallback(async () => {
    if (!audit || !item) return;
    const trimmed = noteDraft.trim();
    setNoteOpen(false);
    setAudit((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) =>
              i.id === item.id ? { ...i, notes: trimmed || null } : i,
            ),
          }
        : prev,
    );
    try {
      await updateAuditItem(audit.id, item.id, {
        notes: trimmed || null,
      });
    } catch {
      load();
    }
  }, [audit, item, noteDraft, load]);

  const handleCapture = useCallback(
    async (photo: CapturedPhoto) => {
      setCameraOpen(false);
      if (!audit || !item) return;
      setUploadingFor(item.id);
      try {
        const url = await uploadPhoto(photo);
        await updateAuditItem(audit.id, item.id, { addPhoto: url });
        setAudit((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((i) =>
                  i.id === item.id
                    ? { ...i, photos: [...i.photos, url] }
                    : i,
                ),
              }
            : prev,
        );
      } catch (e) {
        Alert.alert(
          "Upload failed",
          e instanceof Error ? e.message : "Try again.",
        );
      } finally {
        setUploadingFor(null);
      }
    },
    [audit, item],
  );

  const removePhoto = useCallback(
    async (url: string) => {
      if (!audit || !item) return;
      Alert.alert("Remove photo?", "", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setUploadingFor(item.id);
            try {
              await updateAuditItem(audit.id, item.id, { removePhoto: url });
              setAudit((prev) =>
                prev
                  ? {
                      ...prev,
                      items: prev.items.map((i) =>
                        i.id === item.id
                          ? { ...i, photos: i.photos.filter((p) => p !== url) }
                          : i,
                      ),
                    }
                  : prev,
              );
            } finally {
              setUploadingFor(null);
            }
          },
        },
      ]);
    },
    [audit, item],
  );

  const submitComplete = useCallback(async () => {
    if (!audit) return;
    setCompleting(true);
    try {
      await completeAudit(audit.id, overallNotes || undefined);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      Alert.alert("Audit submitted", "", [
        { text: "Done", onPress: () => router.replace("/audit") },
      ]);
    } catch (e) {
      Alert.alert(
        "Couldn't submit",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setCompleting(false);
    }
  }, [audit, overallNotes, router]);

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

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  if (error || !audit) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-danger text-center">
          {error ?? "Audit not found"}
        </Text>
      </View>
    );
  }

  if (isCompleted) {
    return (
      <CompletedView
        audit={audit}
        onPreview={setPreviewUrl}
        previewUrl={previewUrl}
        clearPreview={() => setPreviewUrl(null)}
      />
    );
  }

  if (!item) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-sm text-muted-fg">No items in this audit.</Text>
      </View>
    );
  }

  return (
    <Screen>
      <PageHeader
        title={audit.template.name}
        subtitle={`${cursor + 1} of ${total} · ${rated} rated`}
        back
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Sticky progress bar — sits right below PageHeader */}
        <View className="border-b border-border bg-background pb-3">
          <View className="h-1.5 overflow-hidden rounded-full bg-primary-50">
            <View
              className="h-full bg-primary"
              style={{ width: `${((cursor + 1) / total) * 100}%` }}
            />
          </View>
        </View>

        {/* Question */}
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pt-6 pb-12"
        >
          <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
            {item.sectionName}
          </Text>
          <Text className="mt-1 text-2xl font-display text-espresso">
            {item.itemTitle}
          </Text>
          {item.photoRequired && item.photos.length === 0 ? (
            <View className="mt-3 self-start flex-row items-center gap-1 rounded-full bg-danger/10 px-2 py-1">
              <Camera color="#B91C1C" size={12} />
              <Text className="text-[10px] font-body-bold text-danger">
                Photo required
              </Text>
            </View>
          ) : null}

          {/* Rating controls */}
          <View className="mt-6">
            {item.ratingType === "pass_fail" ? (
              <View className="flex-row gap-2">
                <RatingChip
                  label="Pass"
                  Icon={ThumbsUp}
                  active={item.rating === 1}
                  activeBg="bg-success"
                  activeText="text-white"
                  onPress={() => setRating(1)}
                />
                <RatingChip
                  label="Fail"
                  Icon={ThumbsDown}
                  active={item.rating === 0}
                  activeBg="bg-danger"
                  activeText="text-white"
                  onPress={() => setRating(0)}
                />
                <RatingChip
                  label="N/A"
                  Icon={Minus}
                  active={item.rating === -1}
                  activeBg="bg-muted"
                  activeText="text-white"
                  onPress={() => setRating(-1)}
                />
              </View>
            ) : item.ratingType === "rating_5" ? (
              <View className="flex-row items-center justify-around">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setRating(n)}
                    className="h-14 w-14 items-center justify-center active:opacity-70"
                  >
                    <Star
                      color={
                        item.rating !== null && n <= item.rating
                          ? "#FBBF24"
                          : "#E5E7EB"
                      }
                      fill={
                        item.rating !== null && n <= item.rating
                          ? "#FBBF24"
                          : "transparent"
                      }
                      size={36}
                    />
                  </Pressable>
                ))}
              </View>
            ) : item.ratingType === "rating_3" ? (
              <View className="flex-row gap-2">
                <RatingChip
                  label="Good"
                  active={item.rating === 3}
                  activeBg="bg-success"
                  activeText="text-white"
                  onPress={() => setRating(3)}
                />
                <RatingChip
                  label="Fair"
                  active={item.rating === 2}
                  activeBg="bg-amber-500"
                  activeText="text-white"
                  onPress={() => setRating(2)}
                />
                <RatingChip
                  label="Poor"
                  active={item.rating === 1}
                  activeBg="bg-danger"
                  activeText="text-white"
                  onPress={() => setRating(1)}
                />
              </View>
            ) : null}
          </View>

          {/* Notes inline display */}
          {item.notes ? (
            <View className="mt-5 rounded-2xl bg-blue-50 px-3 py-2">
              <Text className="text-xs font-body text-blue-700">
                {item.notes}
              </Text>
            </View>
          ) : null}

          {/* Photos */}
          {item.photos.length > 0 ? (
            <View className="mt-5 flex-row flex-wrap gap-2">
              {item.photos.map((url) => (
                <View key={url} className="relative">
                  <Pressable onPress={() => setPreviewUrl(url)}>
                    <Image
                      source={{ uri: url }}
                      style={{ width: 80, height: 80, borderRadius: 12 }}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => removePhoto(url)}
                    className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-black/70"
                  >
                    <X color="#FFFFFF" size={10} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* Add photo / note */}
          <View className="mt-6 flex-row gap-2">
            <Pressable
              onPress={() => setCameraOpen(true)}
              className="h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border active:bg-primary-50"
            >
              {uploadingFor === item.id ? (
                <ActivityIndicator color="#A2492C" size="small" />
              ) : (
                <Camera color="#4A4A4A" size={16} />
              )}
              <Text className="text-sm font-body-bold text-espresso">
                {item.photos.length > 0 ? "Add another" : "Add photo"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setNoteDraft(item.notes ?? "");
                setNoteOpen(true);
              }}
              className="h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border active:bg-primary-50"
            >
              <MessageSquare color="#4A4A4A" size={16} />
              <Text className="text-sm font-body-bold text-espresso">
                {item.notes ? "Edit note" : "Add note"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Bottom nav */}
        <View className="border-t border-border bg-background px-5 pt-3 pb-8">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => setCursor((c) => Math.max(0, c - 1))}
              disabled={cursor === 0}
              className={`h-14 w-14 items-center justify-center rounded-2xl ${
                cursor === 0 ? "bg-primary-50/50" : "bg-primary-50"
              }`}
            >
              <ChevronLeft
                color={cursor === 0 ? "#D1D5DB" : "#A2492C"}
                size={22}
              />
            </Pressable>
            {cursor === total - 1 ? (
              <Pressable
                onPress={() => setCompleteStep(true)}
                disabled={rated === 0}
                className={`h-14 flex-1 items-center justify-center rounded-2xl ${
                  rated > 0 ? "bg-primary" : "bg-primary/40"
                }`}
              >
                <Text className="text-base font-body-bold text-white">
                  Review & submit ({rated}/{total})
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setCursor((c) => Math.min(total - 1, c + 1))}
                className="h-14 flex-1 flex-row items-center justify-center gap-1 rounded-2xl bg-primary active:opacity-80"
              >
                <Text className="text-base font-body-bold text-white">
                  Next
                </Text>
                <ChevronRight color="#FFFFFF" size={20} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Note bottom sheet */}
        <Modal
          visible={noteOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setNoteOpen(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View className="flex-1 bg-background">
              <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
                <Text className="text-xl font-display text-espresso">Note</Text>
                <Pressable
                  onPress={() => setNoteOpen(false)}
                  className="px-2 py-1"
                >
                  <Text className="text-sm font-body-bold text-muted">
                    Cancel
                  </Text>
                </Pressable>
              </View>
              <View className="px-5 pt-4">
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Add a note for this item…"
                  placeholderTextColor="#9B9B9B"
                  multiline
                  autoFocus
                  className="min-h-32 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
                />
              </View>
              <View className="mt-auto p-5">
                <Pressable
                  onPress={saveNote}
                  className="h-14 items-center justify-center rounded-2xl bg-primary active:opacity-80"
                >
                  <Text className="text-base font-body-bold text-white">
                    Save note
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Complete sheet */}
        <Modal
          visible={completeStep}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setCompleteStep(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View className="flex-1 bg-background">
              <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
                <Text className="text-xl font-display text-espresso">
                  Submit audit
                </Text>
                <Pressable
                  onPress={() => setCompleteStep(false)}
                  className="px-2 py-1"
                >
                  <Text className="text-sm font-body-bold text-muted">
                    Cancel
                  </Text>
                </Pressable>
              </View>
              <ScrollView contentContainerClassName="px-5 pt-4 pb-12">
                <View className="rounded-2xl border border-border bg-surface p-4">
                  <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
                    Summary
                  </Text>
                  <Text className="mt-1 text-2xl font-display text-espresso">
                    {rated}/{total} items rated
                  </Text>
                  {rated < total ? (
                    <Text className="mt-1 text-xs font-body text-amber-700">
                      {total - rated} item{total - rated === 1 ? "" : "s"} still
                      unrated — they will be treated as N/A.
                    </Text>
                  ) : null}
                </View>
                <Text className="mt-5 text-xs font-body-semi uppercase tracking-wide text-muted">
                  Overall notes (optional)
                </Text>
                <TextInput
                  value={overallNotes}
                  onChangeText={setOverallNotes}
                  placeholder="Add a comment for this audit…"
                  placeholderTextColor="#9B9B9B"
                  multiline
                  className="mt-2 min-h-32 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
                />
              </ScrollView>
              <View className="border-t border-border p-5">
                <Pressable
                  onPress={submitComplete}
                  disabled={completing}
                  className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl ${completing ? "bg-primary/40" : "bg-primary"}`}
                >
                  {completing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <CheckCircle2 color="#FFFFFF" size={20} />
                      <Text className="text-base font-body-bold text-white">
                        Submit audit
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Photo preview */}
        <Modal
          visible={previewUrl !== null}
          animationType="fade"
          transparent
          onRequestClose={() => setPreviewUrl(null)}
        >
          <View className="flex-1 bg-black/80 items-center justify-center">
            {previewUrl ? (
              <Image
                source={{ uri: previewUrl }}
                style={{ width: "90%", height: "70%" }}
                resizeMode="contain"
              />
            ) : null}
            <Pressable
              onPress={() => setPreviewUrl(null)}
              className="absolute right-5 top-12 h-10 w-10 items-center justify-center rounded-full bg-white/20"
            >
              <X color="#FFFFFF" size={20} />
            </Pressable>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function RatingChip({
  label,
  Icon,
  active,
  activeBg,
  activeText,
  onPress,
}: {
  label: string;
  Icon?: React.ComponentType<{ color?: string; size?: number }>;
  active: boolean;
  activeBg: string;
  activeText: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-80 ${active ? activeBg : "bg-primary-50"}`}
    >
      {Icon ? (
        <Icon color={active ? "#FFFFFF" : "#A2492C"} size={18} />
      ) : null}
      <Text
        className={`text-base font-body-bold ${active ? activeText : "text-primary"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CompletedView({
  audit,
  onPreview,
  previewUrl,
  clearPreview,
}: {
  audit: AuditDetail;
  onPreview: (url: string) => void;
  previewUrl: string | null;
  clearPreview: () => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, typeof audit.items> = {};
    for (const it of audit.items) {
      if (!g[it.sectionName]) g[it.sectionName] = [];
      g[it.sectionName].push(it);
    }
    return g;
  }, [audit.items]);

  return (
    <Screen>
      <PageHeader title={audit.template.name} subtitle="Completed audit" back />
      <ScrollView contentContainerClassName="pt-2 pb-12">
        <View className="mt-1 flex-row items-end gap-2">
          <Text className="text-4xl font-display text-espresso">
            {audit.overallScore ?? 0}
          </Text>
          <Text className="mb-1 text-base font-body text-muted">%</Text>
          <View
            className={`mb-1 ml-2 rounded-full px-2 py-0.5 ${
              (audit.overallScore ?? 0) >= 80
                ? "bg-success/10"
                : (audit.overallScore ?? 0) >= 60
                  ? "bg-amber-100"
                  : "bg-danger/10"
            }`}
          >
            <Text
              className={`text-xs font-body-bold ${
                (audit.overallScore ?? 0) >= 80
                  ? "text-success"
                  : (audit.overallScore ?? 0) >= 60
                    ? "text-amber-700"
                    : "text-danger"
              }`}
            >
              Completed
            </Text>
          </View>
        </View>
        <Text className="mt-1 text-sm font-body text-muted-fg">
          {audit.outlet.name} · {audit.date} · {audit.auditor.name}
        </Text>

        {audit.overallNotes ? (
          <View className="mt-4 rounded-2xl bg-blue-50 px-3 py-2">
            <Text className="text-xs font-body-semi uppercase text-blue-700">
              Overall notes
            </Text>
            <Text className="mt-1 text-sm font-body text-blue-900">
              {audit.overallNotes}
            </Text>
          </View>
        ) : null}

        {Object.entries(grouped).map(([section, sectionItems]) => (
          <View key={section} className="mt-5">
            <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              {section}
            </Text>
            <View className="gap-1.5">
              {sectionItems.map((i) => (
                <View
                  key={i.id}
                  className="rounded-2xl border border-border bg-surface p-3"
                >
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-sm font-body-medium text-espresso">
                      {i.itemTitle}
                    </Text>
                    {i.rating === null ? (
                      <Text className="text-xs font-body text-muted">N/A</Text>
                    ) : i.ratingType === "pass_fail" ? (
                      <View
                        className={`rounded-full px-2 py-0.5 ${
                          i.rating === 1
                            ? "bg-success/10"
                            : i.rating === 0
                              ? "bg-danger/10"
                              : "bg-primary-50"
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-body-bold ${
                            i.rating === 1
                              ? "text-success"
                              : i.rating === 0
                                ? "text-danger"
                                : "text-muted"
                          }`}
                        >
                          {i.rating === 1 ? "PASS" : i.rating === 0 ? "FAIL" : "N/A"}
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-sm font-body-bold text-espresso">
                        {i.rating}
                      </Text>
                    )}
                  </View>
                  {i.notes ? (
                    <Text className="mt-1 text-xs font-body text-blue-700">
                      {i.notes}
                    </Text>
                  ) : null}
                  {i.photos.length > 0 ? (
                    <View className="mt-2 flex-row gap-2">
                      {i.photos.map((url) => (
                        <Pressable key={url} onPress={() => onPreview(url)}>
                          <Image
                            source={{ uri: url }}
                            style={{ width: 56, height: 56, borderRadius: 8 }}
                          />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal
        visible={previewUrl !== null}
        animationType="fade"
        transparent
        onRequestClose={clearPreview}
      >
        <View className="flex-1 bg-black/80 items-center justify-center">
          {previewUrl ? (
            <Image
              source={{ uri: previewUrl }}
              style={{ width: "90%", height: "70%" }}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            onPress={clearPreview}
            className="absolute right-5 top-12 h-10 w-10 items-center justify-center rounded-full bg-white/20"
          >
            <X color="#FFFFFF" size={20} />
          </Pressable>
        </View>
      </Modal>
    </Screen>
  );
}
