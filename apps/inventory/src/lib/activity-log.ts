import { prisma } from "@/lib/prisma";

export async function logActivity(params: {
  userId: string;
  action: string;
  module: string;
  details?: string;
  targetId?: string;
  targetName?: string;
}) {
  try {
    await prisma.activityLog.create({ data: params });
  } catch {
    // Don't let logging failures break the main flow
    console.error("Failed to log activity:", params);
  }
}
