import { NextResponse } from 'next/server';

// GET /api/settings/system — system settings (PIN length is fixed at 6)
export async function GET() {
  return NextResponse.json({ pinLength: 6 });
}
