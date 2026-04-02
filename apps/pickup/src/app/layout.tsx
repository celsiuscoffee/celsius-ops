import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celsius Pickup",
  description: "Online ordering & pickup for Celsius Coffee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
