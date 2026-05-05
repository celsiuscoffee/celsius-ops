import { useEffect, useState } from "react";
import { View, Image, Pressable, Text, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import { getSplashPoster, type SplashPoster as Poster } from "../lib/splash";

type Props = { onDone: () => void };

export function SplashPoster({ onDone }: Props) {
  const [poster, setPoster] = useState<Poster | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const { width: w, height: h } = useWindowDimensions();

  useEffect(() => {
    let cancelled = false;
    let countdownInterval: ReturnType<typeof setInterval> | undefined;
    let dismissTimeout: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const p = await getSplashPoster();
      if (cancelled) return;
      if (!p) {
        onDone();
        return;
      }
      setPoster(p);
      setLoading(false);

      const totalSec = Math.max(1, Math.ceil(p.durationMs / 1000));
      setSecondsLeft(totalSec);
      countdownInterval = setInterval(() => {
        setSecondsLeft((s) => (s > 1 ? s - 1 : 0));
      }, 1000);
      dismissTimeout = setTimeout(onDone, p.durationMs);
    })();
    return () => {
      cancelled = true;
      if (countdownInterval) clearInterval(countdownInterval);
      if (dismissTimeout) clearTimeout(dismissTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !poster) return null;

  const handleTap = () => {
    if (poster.deeplink) {
      onDone();
      // Allow router to push the deeplink target
      setTimeout(() => router.push(poster.deeplink as any), 50);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: w,
        height: h,
        backgroundColor: "#160800",
        zIndex: 9999,
      }}
    >
      <Pressable onPress={handleTap} style={{ width: "100%", height: "100%" }}>
        <Image
          source={{ uri: poster.imageUrl }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      </Pressable>
      <Pressable
        onPress={onDone}
        hitSlop={20}
        style={{
          position: "absolute",
          top: 60,
          right: 20,
          height: 32,
          paddingHorizontal: 12,
          borderRadius: 16,
          backgroundColor: "rgba(0,0,0,0.55)",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        {secondsLeft > 0 && (
          <Text
            style={{
              color: "#FFFFFF",
              fontFamily: "SpaceGrotesk_700Bold",
              fontSize: 12,
              minWidth: 10,
              textAlign: "center",
            }}
          >
            {secondsLeft}
          </Text>
        )}
        <X size={14} color="#FFFFFF" strokeWidth={2.5} />
      </Pressable>
      {poster.deeplink && (
        <View
          style={{
            position: "absolute",
            bottom: 80,
            left: 0,
            right: 0,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.7)",
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Tap to open
          </Text>
        </View>
      )}
    </View>
  );
}
