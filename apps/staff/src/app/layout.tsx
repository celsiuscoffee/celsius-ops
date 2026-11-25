import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { Toaster } from "@celsius/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celsius Staff",
  description: "Outlet operations app for Celsius Coffee",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Celsius Staff",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Celsius UI --bg in each theme (the status bar sits on the page)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F3F0" },
    { media: "(prefers-color-scheme: dark)", color: "#120B08" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Light and dark follow the phone (Celsius UI): set `.dark` before
            the first paint and keep it in step when the phone switches. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){document.documentElement.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full bg-bg font-sans text-text antialiased">
        <ServiceWorkerRegister />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
