import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

export type CapturedPhoto = {
  uri: string;
  base64?: string;
};

export function ReceiptCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (p: CapturedPhoto) => void;
  onCancel: () => void;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-espresso px-6">
        <Text className="text-base text-background text-center">
          Camera access is needed to capture a receipt.
        </Text>
        <Pressable
          onPress={requestPerm}
          className="mt-4 h-12 items-center justify-center rounded-2xl bg-background px-6"
        >
          <Text className="text-base font-body-bold text-espresso">
            Allow camera
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} className="mt-3">
          <Text className="text-sm text-background/80">Cancel</Text>
        </Pressable>
      </View>
    );
  }

  async function snap() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
        exif: false,
      });
      if (photo) onCapture({ uri: photo.uri, base64: photo.base64 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-espresso">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        ratio="4:3"
      />
      <View className="absolute inset-x-0 bottom-0 flex-row items-center justify-between p-6">
        <Pressable onPress={onCancel} className="px-4 py-3">
          <Text className="text-base font-body-bold text-white">Cancel</Text>
        </Pressable>
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
        <View className="w-20" />
      </View>
    </View>
  );
}
