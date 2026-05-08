import { create } from "zustand";

/**
 * Lightweight global toast for confirmation messages — "5 items added",
 * "Reward applied", etc. Sits at the top of the screen for 2.5s by
 * default, slides in/out with reanimated. Avoids dragging in a heavy
 * toast library when all we need is a non-blocking "done" feedback.
 *
 * Use:
 *   import { showToast } from "../lib/toast";
 *   showToast({ message: "5 items added", action: { label: "Review cart", onPress: () => router.push("/cart") } });
 *
 * Mounted once via <Toast /> in app/_layout.tsx so any screen can call.
 */
export type ToastAction = {
  label: string;
  onPress: () => void;
};

export type ToastConfig = {
  id: number;
  message: string;
  action?: ToastAction;
  /** ms to stay on screen. Default 2500. */
  durationMs?: number;
  /** "info" (espresso) | "success" (terracotta-tinted). Default info. */
  variant?: "info" | "success";
};

type ToastStore = {
  current: ToastConfig | null;
  show: (cfg: Omit<ToastConfig, "id">) => void;
  dismiss: () => void;
};

export const useToast = create<ToastStore>((set) => ({
  current: null,
  show: (cfg) =>
    set({
      current: {
        id: Date.now() + Math.random(),
        durationMs: 2500,
        variant: "info",
        ...cfg,
      },
    }),
  dismiss: () => set({ current: null }),
}));

export const showToast = (cfg: Omit<ToastConfig, "id">) => useToast.getState().show(cfg);
