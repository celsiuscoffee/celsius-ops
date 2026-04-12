import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celsius POS",
  description: "Celsius Coffee Point of Sale",
  icons: {
    icon: "/icon.png",
    apple: "/images/celsius-logo-sm.jpg",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-surface text-text antialiased dark">{children}</body>
    </html>
  );
}
