import type { Metadata } from "next";
import AdminLayoutClient from "./_components/admin-layout-client";

export const metadata: Metadata = {
  manifest: "/manifest-admin.json",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
