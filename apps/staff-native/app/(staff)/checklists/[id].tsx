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
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Camera,
  CheckCircle2,
  Circle,
  Image as ImageIcon,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react-native";
import {
  getChecklist,
  updateChecklistItem,
  type ChecklistDetail,
  type ChecklistItem,
} from "../../../lib/ops/checklists";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import { uploadPhoto } from "../../../lib/upload";

export default function ChecklistDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<ChecklistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [cameraOpenFor, setCameraOpenFor] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const data = await getChecklist(id);
        setDetail(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load");
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const toggleItem = useCallback(
    async (item: ChecklistItem) => {
      if (!detail) return;
      if (!item.isCompleted && item.photoRequired && !item.photoUrl) {
        Alert.alert(
          "Photo required",
          "Take a photo for this step first.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open camera",
              onPress: () => setCameraOpenFor(item.id),
            },
          ],
        );
        return;
      }
      const next = !item.isCompleted;
      // Optimistic update + haptic
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === item.id ? { ...i, isCompleted: next } : i,
              ),
            }
          : prev,
      );
      Haptics.impactAsync(
        next
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light,
      ).catch(() => {});
      try {
        await updateChecklistItem(detail.id, item.id, { isCompleted: next });
      } catch (e) {
        // Revert
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((i) =>
                  i.id === item.id
                    ? { ...i, isCompleted: !next }
                    : i,
                ),
              }
            : prev,
        );
        Alert.alert("Couldn't update", e instanceof Error ? e.message : "Try again.");
      }
    },
    [detail],
  );

  const saveNote = useCallback(
    async (itemId: string) => {
      if (!detail) return;
      const trimmed = noteDraft.trim();
      setNoteOpenFor(null);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.id === itemId ? { ...i, notes: trimmed || null } : i,
              ),
            }
          : prev,
      );
      try {
        await updateChecklistItem(detail.id, itemId, {
          notes: trimmed || null,
        });
      } catch {
        load(true);
      }
    },
    [detail, noteDraft, load],
  );

  const handleCapture = useCallback(
    async (photo: CapturedPhoto) => {
      const itemId = cameraOpenFor;
      setCameraOpenFor(null);
      if (!detail || !itemId) return;
      setUploadingFor(itemId);
      try {
        const url = await uploadPhoto(photo);
        await updateChecklistItem(detail.id, itemId, { photoUrl: url });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((i) =>
                  i.id === itemId ? { ...i, photoUrl: url } : i,
                ),
              }
            : prev,
        );
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      } catch (e) {
        Alert.alert(
          "Upload failed",
          e instanceof Error ? e.message : "Try again.",
        );
      } finally {
        setUploadingFor(null);
      }
    },
    [cameraOpenFor, detail],
  );

  const deletePhoto = useCallback(
    async (itemId: string) => {
      if (!detail) return;
      Alert.alert(
        "Remove photo?",
        "The item will be un-ticked if it was auto-completed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              setUploadingFor(itemId);
              try {
                await updateChecklistItem(detail.id, itemId, {
                  photoUrl: null,
                });
                setDetail((prev) =>
                  prev
                    ? {
                        ...prev,
                        items: prev.items.map((i) =>
                          i.id === itemId ? { ...i, photoUrl: null } : i,
                        ),
                      }
                    : prev,
                );
              } finally {
                setUploadingFor(null);
              }
            },
          },
        ],
      );
    },
    [detail],
  );

  const completed = useMemo(
    () => detail?.items.filter((i) => i.isCompleted).length ?? 0,
    [detail?.items],
  );
  const total = detail?.items.length ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (cameraOpenFor) {
    return (
      <Modal animationType="slide" presentationStyle="fullScreen">
        <ReceiptCapture
          onCapture={handleCapture}
          onCancel={() => setCameraOpenFor(null)}
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

  if (error || !detail) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-danger text-center">
          {error ?? "Checklist not found"}
        </Text>
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
        contentContainerClassName="px-5 pt-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
          {detail.outlet.name} · {detail.sop.category.name}
        </Text>
        <Text className="mt-1 text-2xl font-display text-espresso">
          {detail.sop.title}
        </Text>

        {/* Progress */}
        <View className="mt-4 rounded-3xl border border-border bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-body-semi text-espresso">
              Progress
            </Text>
            <Text className="text-sm font-body-bold text-espresso">
              {completed}/{total} · {pct}%
            </Text>
          </View>
          <View className="mt-2 h-2 overflow-hidden rounded-full bg-primary-50">
            <View
              className={`h-full ${pct === 100 ? "bg-success" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </View>
          {detail.status === "COMPLETED" && detail.completedBy ? (
            <Text className="mt-2 text-xs font-body text-success">
              Completed by {detail.completedBy.name}
            </Text>
          ) : null}
        </View>

        {/* Guidelines */}
        {detail.sop.content ? (
          <View className="mt-4 rounded-3xl border border-border bg-surface p-4">
            <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
              Guidelines
            </Text>
            <Text className="mt-2 text-sm font-body text-muted-fg leading-5">
              {detail.sop.content}
            </Text>
          </View>
        ) : null}

        {/* Items */}
        <View className="mt-4 gap-2">
          {detail.items.map((item) => (
            <View
              key={item.id}
              className={`rounded-3xl border bg-surface p-4 ${
                item.isCompleted ? "border-success/30 opacity-80" : "border-border"
              }`}
            >
              <Pressable
                onPress={() => toggleItem(item)}
                className="flex-row items-start gap-3 active:opacity-80"
              >
                <View className="mt-0.5">
                  {item.isCompleted ? (
                    <CheckCircle2 color="#15803D" size={26} />
                  ) : (
                    <Circle color="#D1D5DB" size={26} />
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-xs font-body-bold text-primary">
                      #{item.stepNumber}
                    </Text>
                    <Text
                      className={`text-base font-body-medium ${
                        item.isCompleted
                          ? "text-muted-fg line-through"
                          : "text-espresso"
                      }`}
                    >
                      {item.title}
                    </Text>
                  </View>
                  {item.description ? (
                    <Text className="mt-1 text-sm font-body text-muted-fg">
                      {item.description}
                    </Text>
                  ) : null}
                  {item.photoRequired ? (
                    <View
                      className={`mt-1.5 self-start flex-row items-center gap-1 rounded-full px-2 py-0.5 ${
                        item.photoUrl ? "bg-success/10" : "bg-danger/10"
                      }`}
                    >
                      <Camera
                        color={item.photoUrl ? "#15803D" : "#B91C1C"}
                        size={10}
                      />
                      <Text
                        className={`text-[10px] font-body-bold ${
                          item.photoUrl ? "text-success" : "text-danger"
                        }`}
                      >
                        {item.photoUrl ? "Photo attached" : "Photo required"}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>

              {/* Photo + Note */}
              {(item.photoUrl || item.notes || uploadingFor === item.id) ? (
                <View className="mt-3 gap-2">
                  {item.notes ? (
                    <View className="rounded-2xl bg-blue-50 px-3 py-2">
                      <Text className="text-xs font-body text-blue-700">
                        {item.notes}
                      </Text>
                    </View>
                  ) : null}
                  {uploadingFor === item.id ? (
                    <View className="flex-row items-center gap-2">
                      <ActivityIndicator color="#A2492C" size="small" />
                      <Text className="text-xs font-body text-muted">
                        Uploading photo…
                      </Text>
                    </View>
                  ) : item.photoUrl ? (
                    <View className="flex-row gap-2">
                      <Pressable
                        onPress={() => setPreviewUrl(item.photoUrl)}
                        className="rounded-2xl overflow-hidden"
                      >
                        <Image
                          source={{ uri: item.photoUrl }}
                          style={{ width: 96, height: 96 }}
                          resizeMode="cover"
                        />
                      </Pressable>
                      <View className="flex-1 justify-end gap-2">
                        <Pressable
                          onPress={() => setCameraOpenFor(item.id)}
                          className="h-9 flex-row items-center justify-center gap-1 rounded-xl bg-primary-50"
                        >
                          <RotateCcw color="#A2492C" size={14} />
                          <Text className="text-xs font-body-bold text-primary">
                            Retake
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => deletePhoto(item.id)}
                          className="h-9 items-center justify-center rounded-xl border border-danger/30"
                        >
                          <Text className="text-xs font-body-bold text-danger">
                            Remove
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Actions */}
              <View className="mt-3 flex-row gap-2">
                <Pressable
                  onPress={() => setCameraOpenFor(item.id)}
                  className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border active:bg-primary-50"
                >
                  {item.photoUrl ? (
                    <ImageIcon color="#15803D" size={14} />
                  ) : (
                    <Camera color="#4A4A4A" size={14} />
                  )}
                  <Text className="text-xs font-body-bold text-espresso">
                    {item.photoUrl ? "Replace photo" : "Add photo"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setNoteDraft(item.notes ?? "");
                    setNoteOpenFor(item.id);
                  }}
                  className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border active:bg-primary-50"
                >
                  <MessageSquare color="#4A4A4A" size={14} />
                  <Text className="text-xs font-body-bold text-espresso">
                    {item.notes ? "Edit note" : "Add note"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Note bottom sheet */}
      <Modal
        visible={noteOpenFor !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNoteOpenFor(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-background">
            <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
              <Text className="text-xl font-display text-espresso">Note</Text>
              <Pressable
                onPress={() => setNoteOpenFor(null)}
                className="px-2 py-1"
              >
                <Text className="text-sm font-body-bold text-muted">Cancel</Text>
              </Pressable>
            </View>
            <View className="px-5 pt-4">
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Add a quick note for this step…"
                placeholderTextColor="#9B9B9B"
                multiline
                autoFocus
                className="min-h-32 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
              />
            </View>
            <View className="mt-auto p-5">
              <Pressable
                onPress={() => noteOpenFor && saveNote(noteOpenFor)}
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

      {/* Photo preview modal */}
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
  );
}
