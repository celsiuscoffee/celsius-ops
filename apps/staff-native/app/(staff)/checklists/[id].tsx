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
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
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
import { useCelsius } from "../../../lib/celsius-ui";

export default function ChecklistDetail() {
  const C = useCelsius().color;
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
      } catch (e) {
        // Surface the failure: the optimistic note + load(true) reverts it, so
        // without an alert the staffer believes it saved (mirrors the toggle
        // handler above, which already alerts on failure).
        Alert.alert("Couldn't save note", e instanceof Error ? e.message : "Try again.");
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
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={C["text-3"]} />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-6">
        <Text className="text-sm text-danger-text text-center">
          {error ?? "Checklist not found"}
        </Text>
      </View>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader
        title={detail.sop.title}
        subtitle={`${detail.outlet.name} · ${detail.sop.category.name}`}
        back
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="pt-2 pb-6"
          keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
        {/* Progress */}
        <View className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-body-semi text-text">
              Progress
            </Text>
            <Text className="text-base font-body-bold text-text">
              {completed}/{total} · {pct}%
            </Text>
          </View>
          <View className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
            <View
              className={`h-full ${pct === 100 ? "bg-ok" : "bg-ink"}`}
              style={{ width: `${pct}%` }}
            />
          </View>
          {detail.status === "COMPLETED" && detail.completedBy ? (
            <Text className="mt-2 text-xs font-body text-ok-text">
              Completed by {detail.completedBy.name}
            </Text>
          ) : null}
        </View>

        {/* Guidelines */}
        {detail.sop.content ? (
          <View className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <Text className="text-sm font-body-semi text-text-2">
              Guidelines
            </Text>
            <Text className="mt-2 text-sm font-body text-text-2 leading-5">
              {detail.sop.content}
            </Text>
          </View>
        ) : null}

        {/* Items */}
        <View className="mt-4 gap-2">
          {detail.items.map((item) => (
            <View
              key={item.id}
              className={`rounded-2xl border bg-surface p-4 ${
                item.isCompleted ? "border-ok opacity-80" : "border-line"
              }`}
            >
              <Pressable
                onPress={() => toggleItem(item)}
                className="flex-row items-start gap-3 active:opacity-80"
              >
                <View className="mt-0.5">
                  {item.isCompleted ? (
                    <CheckCircle2 color={C["ok-text"]} size={26} />
                  ) : (
                    <Circle color={C["text-3"]} size={26} />
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-xs font-body-bold text-text">
                      #{item.stepNumber}
                    </Text>
                    <Text
                      className={`text-base font-body-medium ${
                        item.isCompleted
                          ? "text-text-2 line-through"
                          : "text-text"
                      }`}
                    >
                      {item.title}
                    </Text>
                  </View>
                  {item.description ? (
                    <Text className="mt-1 text-sm font-body text-text-2">
                      {item.description}
                    </Text>
                  ) : null}
                  {item.photoRequired ? (
                    <View
                      className={`mt-1.5 self-start flex-row items-center gap-1 rounded-full px-2 py-0.5 ${
                        item.photoUrl ? "bg-ok-soft" : "bg-danger-soft"
                      }`}
                    >
                      <Camera
                        color={item.photoUrl ? C["ok-text"] : C.danger}
                        size={10}
                      />
                      <Text
                        className={`text-xs font-body-bold ${
                          item.photoUrl ? "text-ok-text" : "text-danger-text"
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
                    <View className="rounded-2xl bg-info-soft px-3 py-2">
                      <Text className="text-xs font-body text-info-text">
                        {item.notes}
                      </Text>
                    </View>
                  ) : null}
                  {uploadingFor === item.id ? (
                    <View className="flex-row items-center gap-2">
                      <ActivityIndicator color={C["text-3"]} size="small" />
                      <Text className="text-xs font-body text-text-3">
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
                          className="h-11 flex-row items-center justify-center gap-1 rounded-xl bg-sunken"
                        >
                          <RotateCcw color={C["text-2"]} size={14} />
                          <Text className="text-xs font-body-bold text-text">
                            Retake
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => deletePhoto(item.id)}
                          className="h-11 items-center justify-center rounded-xl border border-danger"
                        >
                          <Text className="text-xs font-body-bold text-danger-text">
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
                  className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-line active:bg-sunken"
                >
                  {item.photoUrl ? (
                    <ImageIcon color={C["ok-text"]} size={14} />
                  ) : (
                    <Camera color={C["text-2"]} size={14} />
                  )}
                  <Text className="text-xs font-body-bold text-text">
                    {item.photoUrl ? "Replace photo" : "Add photo"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setNoteDraft(item.notes ?? "");
                    setNoteOpenFor(item.id);
                  }}
                  className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl border border-line active:bg-sunken"
                >
                  <MessageSquare color={C["text-2"]} size={14} />
                  <Text className="text-xs font-body-bold text-text">
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
          <View className="flex-1 bg-bg">
            <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
              <Text className="text-xl font-display text-text">Note</Text>
              <Pressable
                onPress={() => setNoteOpenFor(null)}
                className="min-h-11 justify-center px-3"
              >
                <Text className="text-sm font-body-bold text-text-3">Cancel</Text>
              </Pressable>
            </View>
            <View className="px-5 pt-4">
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Add a quick note for this step…"
                placeholderTextColor={C["text-3"]}
                multiline
                autoFocus
                className="min-h-32 rounded-2xl border border-line bg-surface px-4 py-3 text-base font-body text-text"
              />
            </View>
            <View className="mt-auto p-5">
              <Pressable
                onPress={() => noteOpenFor && saveNote(noteOpenFor)}
                className="h-14 items-center justify-center rounded-2xl bg-ink active:opacity-80"
              >
                <Text className="text-base font-body-bold text-on-ink">
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
            className="absolute right-5 top-16 h-11 w-11 items-center justify-center rounded-full bg-white/20"
          >
            <X color={C["on-hero"]} size={22} />
          </Pressable>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </Screen>
  );
}
