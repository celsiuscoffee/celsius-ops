import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { Toaster } from "@celsius/ui";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Celsius Coffee — Order & Pickup",
  description:
    "Order your favourite Celsius Coffee drinks ahead and skip the queue. Pickup at Shah Alam, Conezion, or Tamarind Square.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Celsius Coffee",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // Deliberately NOT setting h-full on html — that pins the
      // document to viewport height, which prevents iOS Safari from
      // collapsing its URL bar on body scroll. Globals.css already
      // sets body min-height:100dvh so the background still fills the
      // visible area; without an html height clamp, the document can
      // grow with content and Safari sees scroll on the body.
      className={`${spaceGrotesk.variable} antialiased bg-[#160800]`}
    >
      <body className="flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
