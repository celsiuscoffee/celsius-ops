import { NextResponse } from 'next/server';
import { centralDb } from '@/lib/central-db';

// GET /api/settings/system — fetch system settings from central DB (for portal PIN length)
export async function GET() {
  try {
    if (!centralDb) {
      return NextResponse.json({ pinLength: 4 });
    }

    const { data, error } = await centralDb
      .from('SystemSettings')
      .select('pinLength')
      .eq('id', 'default')
      .single();

    if (error || !data) {
      return NextResponse.json({ pinLength: 4 });
    }

    return NextResponse.json({ pinLength: data.pinLength || 4 });
  } catch {
    return NextResponse.json({ pinLength: 4 });
  }
}
