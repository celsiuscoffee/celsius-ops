import { useState } from "react";
import { View, Text, ActivityIndicator, LayoutChangeEvent } from "react-native";
import { ChevronsRight, Check } from "lucide-react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import * as Haptics from "@/lib/haptics";

const THUMB = 56;
const PADDING = 4;

type Props = {
  label?: string;
  doneLabel?: string;
  onComplete: () => Promise<void>;
};

/**
 * Swipe-to-confirm thumb. Customer drags the right-arrow thumb across
 * the track; on full swipe the onComplete promise runs while the thumb
 * stays pinned to the right and a spinner shows. After resolution we
 * swap to a "done" check + label and stop accepting gestures.
 */
export function SwipeToCollect({
  label = "Slide to collect",
  doneLabel = "Collected",
  onComplete,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const x = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const maxX = Math.max(0, trackWidth - THUMB - PADDING * 2);

  const finish = async () => {
    setBusy(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onComplete();
      setDone(true);
    } catch {
      // Bounce back on failure
      x.value = withSpring(0, { damping: 18, stiffness: 200 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const pan = Gesture.Pan()
    .enabled(!busy && !done && maxX > 0)
    .onUpdate((e) => {
      const next = Math.max(0, Math.min(e.translationX, maxX));
      x.value = next;
    })
    .onEnd(() => {
      if (x.value >= maxX * 0.85) {
        x.value = withTiming(maxX, { duration: 150 });
        runOnJS(finish)();
      } else {
        x.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: x.value + THUMB + PADDING,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: maxX > 0
      ? interpolate(x.value, [0, maxX * 0.6], [1, 0], Extrapolation.CLAMP)
      : 1,
  }));

  return (
    <View
      onLayout={onLayout}
      style={{
        height: THUMB + PADDING * 2,
        borderRadius: 999,
        backgroundColor: "rgba(46, 125, 50, 0.12)",
        borderWidth: 1,
        borderColor: "rgba(46, 125, 50, 0.3)",
        overflow: "hidden",
        justifyContent: "center",
      }}
    >
      {/* Filled track behind the thumb */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            backgroundColor: "#2E7D32",
            borderRadius: 999,
          },
          fillStyle,
        ]}
      />

      {/* Center label */}
      {!done ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              alignItems: "center",
              justifyContent: "center",
            },
            labelStyle,
          ]}
        >
          <Text
            style={{
              color: "#2E7D32",
              fontFamily: "Peachi-Bold",
              fontSize: 15,
              letterSpacing: 0.3,
            }}
          >
            {label}
          </Text>
        </Animated.View>
      ) : (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontFamily: "Peachi-Bold",
              fontSize: 15,
              letterSpacing: 0.3,
            }}
          >
            {doneLabel}
          </Text>
        </View>
      )}

      {/* Draggable thumb */}
      {!done && (
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              {
                position: "absolute",
                left: PADDING,
                top: PADDING,
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: "#FFFFFF",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
              },
              thumbStyle,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#2E7D32" size="small" />
            ) : (
              <ChevronsRight size={26} color="#2E7D32" strokeWidth={2.5} />
            )}
          </Animated.View>
        </GestureDetector>
      )}

      {/* Static check when done */}
      {done && (
        <View
          style={{
            position: "absolute",
            right: PADDING,
            top: PADDING,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={26} color="#2E7D32" strokeWidth={2.5} />
        </View>
      )}
    </View>
  );
}
