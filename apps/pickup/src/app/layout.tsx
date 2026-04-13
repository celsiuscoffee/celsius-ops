import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Celsius Coffee",
  description: "Order ahead, skip the line",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#160800",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: "#160800", margin: 0 }}>{children}</body>
    </html>
  );
}
