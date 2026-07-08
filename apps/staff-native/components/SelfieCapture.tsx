import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { RotateCcw, X as XIcon } from "lucide-react-native";

// Selfie capture used by the clock-in / clock-out flow. Mirrors
// ReceiptCapture's API but defaults to the front camera and shows a
// live preview frame (oval crop hint) so the user knows to centre
// their face. Returns a base64-encoded JPEG (no data URL prefix) so
// the caller can hand it straight to the backend's `photo` param.
export type CapturedSelfie = {
  uri: string;
  base64: string;
};

export function SelfieCapture({
  onCapture,
  onCancel,
  prompt = "Take a selfie to clock in",
}: {
  onCapture: (p: CapturedSelfie) => void;
  onCancel: () => void;
  prompt?: string;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">("front");
  const cameraRef = useRef<CameraView | null>(null);
  const insets = useSafeAreaInsets();

  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-espresso px-6">
        <Text className="text-base text-white text-center">
          Camera access is needed to take a selfie for the attendance
          log.
        </Text>
        <Pressable
          onPress={requestPerm}
          className="mt-4 h-12 items-center justify-center rounded-2xl bg-white px-6"
        >
          <Text className="text-base font-body-bold text-espresso">
            Allow camera
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} className="mt-3">
          <Text className="text-sm text-white/80">Cancel</Text>
        </Pressable>
      </View>
    );
  }

  async function snap() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        // Lower quality than receipt capture, selfies are for audit,
        // not OCR. Keeps the base64 payload manageable for the JSON
        // POST body (~80-120 KB at 0.5 quality).
        quality: 0.5,
        base64: true,
        exif: false,
      });
      // Selfie is mandatory for clock in/out, a missing base64 payload
      // must surface as an error, not a silent no-op.
      if (!photo?.base64) {
        Alert.alert("Camera error", "Couldn't take the photo. Try again.");
        return;
      }
      onCapture({ uri: photo.uri, base64: photo.base64 });
    } catch {
      Alert.alert("Camera error", "Couldn't take the photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-espresso">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing={facing}
        ratio="4:3"
      />
      {/* Soft oval crop hint so the user centres their face. */}
      <View
        pointerEvents="none"
        className="absolute inset-x-12 top-32 bottom-44 items-center justify-center"
      >
        <View
          style={{
            width: 240,
            height: 320,
            borderRadius: 160,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.5)",
          }}
        />
      </View>

      {/* Top bar, cancel + flip */}
      <View
        className="absolute inset-x-0 flex-row items-center justify-between px-5"
        style={{ top: insets.top + 8 }}
      >
        <Pressable
          onPress={onCancel}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
        >
          <XIcon color="#FFFFFF" size={20} />
        </Pressable>
        <View className="rounded-full bg-black/40 px-3 py-1.5">
          <Text className="text-xs font-body-bold text-white">{prompt}</Text>
        </View>
        <Pressable
          onPress={() => setFacing((f) => (f === "front" ? "back" : "front"))}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
        >
          <RotateCcw color="#FFFFFF" size={18} />
        </Pressable>
      </View>

      {/* Shutter */}
      <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-center p-6">
        <Pressable
          onPress={snap}
          disabled={busy}
          className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/30"
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View className="h-16 w-16 rounded-full bg-white" />
          )}
        </Pressable>
      </View>
    </View>
  );
}
