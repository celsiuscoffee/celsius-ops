import type { Metadata, Viewport } from "next";

// Customer-facing segment — its own title/theme, not the backoffice chrome.
export const metadata: Metadata = {
  title: "Rate your experience — Celsius Coffee",
  description: "Tell us how your visit went. It takes five seconds.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#160800",
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
