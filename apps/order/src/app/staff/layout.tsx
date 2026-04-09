import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Celsius Orders",
  manifest: "/manifest-staff.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Celsius Orders",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#160800",
  viewportFit: "cover",
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
