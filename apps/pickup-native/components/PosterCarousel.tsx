import { useEffect, useRef, useState } from "react";
import {
  View,
  Image,
  Pressable,
  ScrollView,
  useWindowDimensions,
  Linking,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import type { HomePoster } from "../lib/posters";

type Props = {
  posters: HomePoster[];
  // Aspect ratio of the poster (W:H). Default 4:3 — close to Chagee's
  // home hero proportions and works well on most phones.
  aspect?: number;
};

export function PosterCarousel({ posters, aspect = 4 / 3 }: Props) {
  const { width: screenW } = useWindowDimensions();
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  // Track active index in a ref too so the auto-advance timer can read
  // the latest value without re-creating the timer on every change.
  const activeRef = useRef(0);

  const slideW = screenW;
  const slideH = slideW / aspect;

  // Auto-advance every poster.durationMs (defaults to 4.5s server-side).
  // We restart the timer on user-driven swipes and on poster changes.
  useEffect(() => {
    if (posters.length <= 1) return;
    const tick = () => {
      const next = (activeRef.current + 1) % posters.length;
      activeRef.current = next;
      setActive(next);
      scrollRef.current?.scrollTo({ x: next * slideW, animated: true });
    };
    const dur = posters[activeRef.current]?.durationMs ?? 4500;
    const t = setTimeout(tick, dur);
    return () => clearTimeout(t);
    // active is the trigger that resets the timer when slide changes
    // (programmatically OR by user swipe).
  }, [active, posters, slideW]);

  if (posters.length === 0) return null;

  const onPosterTap = (p: HomePoster) => {
    if (!p.deeplink) return;
    Haptics.selectionAsync();
    // Internal route (starts with '/') vs external URL.
    if (p.deeplink.startsWith("/")) {
      router.push(p.deeplink as never);
    } else {
      Linking.openURL(p.deeplink).catch(() => {});
    }
  };

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / slideW);
          activeRef.current = idx;
          setActive(idx);
        }}
        style={{ width: slideW, height: slideH }}
      >
        {posters.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => onPosterTap(p)}
            // Espresso placeholder under the Image so the network
            // download window (a beat or two after sign-in) shows
            // the brand colour instead of a stark white frame. The
            // Image fades in on top once the bitmap arrives.
            style={{
              width: slideW,
              height: slideH,
              backgroundColor: "#160800",
            }}
          >
            <Image
              source={{ uri: p.imageUrl }}
              style={{ width: slideW, height: slideH }}
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </ScrollView>

      {/* Page dots — only shown for 2+ posters. Sit just inside the
          poster's bottom edge in the brand cream so they're legible
          on dark + light photos. Active dot widens slightly per the
          common iOS pattern. */}
      {posters.length > 1 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 12,
            left: 0,
            right: 0,
            flexDirection: "row",
            justifyContent: "center",
            gap: 5,
          }}
        >
          {posters.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === active ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === active ? "#FFFFFF" : "rgba(255,255,255,0.55)",
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
