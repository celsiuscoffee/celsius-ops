import { useEffect, useRef, useState } from "react";
import { Animated, View, Pressable, Text, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { X } from "lucide-react-native";
import { getSplashPoster, type SplashPoster as Poster } from "../lib/splash";
import { logPosterEvent } from "../lib/poster-events";
import { useApp } from "../lib/store";

type Props = { onDone: () => void };

export function SplashPoster({ onDone }: Props) {
  const [poster, setPoster] = useState<Poster | null>(null);
  // True until the poster bitmap is actually decoded onto the screen. We
  // mount the full-screen dark backdrop the moment this component renders
  // so the home page never peeks through during the API fetch + image
  // decode window — which is what produced the "logo → home → splash →
  // home" flash before this fix.
  const [imageReady, setImageReady] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const { width: w, height: h } = useWindowDimensions();
  const imageOpacity = useRef(new Animated.Value(0)).current;
  // May still be null this early on a cold launch (store hydrating) —
  // anonymous events still count toward the poster's impression/CTR totals.
  const loyaltyId = useApp((s) => s.loyaltyId);

  useEffect(() => {
    let cancelled = false;
    let countdownInterval: ReturnType<typeof setInterval> | undefined;
    let dismissTimeout: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const p = await getSplashPoster();
      if (cancelled) return;
      if (!p) {
        // No poster configured — drop straight to home. The backdrop
        // we've been showing in the meantime keeps the transition from
        // logo → home looking clean.
        onDone();
        return;
      }
      setPoster(p);
      // The splash surface logged NOTHING until now — no impressions, no
      // taps — so splash posters were unmeasurable. One impression per
      // launch-with-poster is the CTR denominator.
      logPosterEvent({ posterId: p.id, placement: "splash", eventType: "impression", deeplink: p.deeplink, loyaltyId });
      // Countdown + auto-dismiss start as soon as we have a poster URL,
      // not after the image decodes, so a slow image never extends the
      // intended display window.
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

  const handleTap = () => {
    if (!poster) return;
    if (poster.deeplink) {
      // Tap → 24h last-touch order attribution (attributeOrderToPoster),
      // the same learning signal the home carousel feeds the autopilot.
      logPosterEvent({ posterId: poster.id, placement: "splash", eventType: "tap", deeplink: poster.deeplink, loyaltyId });
      onDone();
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
      {poster && (
        <Pressable onPress={handleTap} style={{ width: "100%", height: "100%" }}>
          <Animated.Image
            source={{ uri: poster.imageUrl }}
            style={{ width: "100%", height: "100%", opacity: imageOpacity }}
            resizeMode="cover"
            onLoad={() => {
              setImageReady(true);
              Animated.timing(imageOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
              }).start();
            }}
          />
        </Pressable>
      )}
      {/* Close + countdown only after the image has actually painted —
          showing a "3 ⨯" badge over an empty dark screen during the
          API fetch window would look broken. */}
      {imageReady && (
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
      )}
      {imageReady && poster?.deeplink && (
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
