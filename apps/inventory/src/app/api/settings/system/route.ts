import { NextResponse } from "next/server";

// GET /api/settings/system — return system settings (PIN length for login page)
// No Prisma dependency — returns sensible defaults
const defaults = { pinLength: 6 };

export async function GET() {
  return NextResponse.json(defaults);
}
