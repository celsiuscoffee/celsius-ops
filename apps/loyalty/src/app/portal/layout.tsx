import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Celsius Coffee - Staff Portal",
  manifest: "/manifest-portal.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Celsius Portal",
  },
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        overscrollBehavior: "none",
      }}
    >
      {children}
    </div>
  );
}
