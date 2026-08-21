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
  maxEdgePx,
  quality = 0.7,
}: {
  onCapture: (p: CapturedPhoto) => void;
  onCancel: () => void;
  /**
   * Cap the capture resolution (longest edge) where the device honours it.
   * Best-effort only: on iOS getAvailablePictureSizesAsync returns preset
   * strings ("photo"/"high"/"hd1920x1080"), not WxH, so the cap silently
   * no-ops there. Not a substitute for uploading the file multipart.
   */
  maxEdgePx?: number;
  /**
   * JPEG compression quality, 0–1 (default 0.7). Lower it for captures that
   * only need to be legible (e.g. an MC photo) to shrink the upload; leave it
   * at the default for OCR'd receipts that need detail.
   */
  quality?: number;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const cameraRef = useRef<CameraView | null>(null);

  // Pick the largest device-supported capture size within maxEdgePx.
  // Best-effort: any failure keeps the device default.
  async function onCameraReady() {
    if (!maxEdgePx || !cameraRef.current) return;
    try {
      const sizes = await cameraRef.current.getAvailablePictureSizesAsync();
      const fit = sizes
        .map((s) => {
          const m = /^(\d+)x(\d+)$/.exec(s);
          return m ? { s, edge: Math.max(Number(m[1]), Number(m[2])) } : null;
        })
        .filter((p): p is { s: string; edge: number } => p !== null)
        .filter((p) => p.edge <= maxEdgePx)
        .sort((a, b) => b.edge - a.edge)[0];
      if (fit) setPictureSize(fit.s);
    } catch {
      // keep default
    }
  }

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
      // No base64: every consumer (claims, receiving, audit, invoices,
      // checklists, leave MC) uploads the file by URI and never reads it, and
      // base64-encoding a full-resolution photo in memory is a known cause of
      // takePictureAsync hanging / OOM-ing on iOS — which looked like "the
      // capture button does nothing".
      const photo = await cameraRef.current.takePictureAsync({
        quality,
        exif: false,
      });
      if (photo) onCapture({ uri: photo.uri });
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
        pictureSize={pictureSize}
        onCameraReady={onCameraReady}
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
