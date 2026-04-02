/**
 * Migrate StoreHub Loyalty customers to Celsius Loyalty Supabase DB
 * FAST version — uses batch inserts (upsert) for 50x speed improvement
 *
 * Usage: npx tsx scripts/migrate-storehub.ts /path/to/Customers.csv
 */

import { createClient } from '@supabase/supabase-js';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kqdcdhpnyuwrxqhbuyfl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BRAND_ID = 'brand-celsius';
const BATCH_SIZE = 200;

if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface StoreHubRow {
  'First Name': string;
  'Last Name': string;
  'Email': string;
  'Phone': string;
  'Birthday': string;
  'Total Spent': string;
  'Total Points': string;
  'Total Transactions': string;
  'Last Purchase Date': string;
  'Tags': string;
  'Customer Id': string;
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('60')) return cleaned;
  if (cleaned.startsWith('0')) return `60${cleaned.slice(1)}`;
  return cleaned;
}

function parseDateMY(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseBirthday(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return dateStr;
}

async function readCSV(filePath: string): Promise<StoreHubRow[]> {
  return new Promise((resolve, reject) => {
    const rows: StoreHubRow[] = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }))
      .on('data', (row: StoreHubRow) => {
        if (row['Phone']?.startsWith('Optional')) return;
        if (row['First Name'] === '#') return;
        if (!row['Phone']?.trim()) return;
        rows.push(row);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

interface ParsedMember {
  phone: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
  tags: string[] | null;
  totalSpent: number;
  totalPoints: number;
  totalTransactions: number;
  lastPurchaseDate: string | null;
}

async function migrate(filePath: string) {
  console.log(`\nReading CSV: ${filePath}`);
  const rows = await readCSV(filePath);
  console.log(`Found ${rows.length} customers to migrate`);

  // Step 1: Parse all rows and deduplicate by phone
  console.log('\nStep 1: Parsing and deduplicating...');
  const membersByPhone = new Map<string, ParsedMember>();
  let skippedInvalid = 0;

  for (const row of rows) {
    const phone = normalizePhone(row['Phone']);
    if (!phone || phone.length < 10) {
      skippedInvalid++;
      continue;
    }

    const firstName = row['First Name']?.trim() || '';
    const lastName = row['Last Name']?.trim() || '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || null;
    const tags = row['Tags']?.trim() ? row['Tags'].split(',').map(t => t.trim()) : null;

    // Keep the one with more data (higher spent)
    const existing = membersByPhone.get(phone);
    const totalSpent = parseFloat(row['Total Spent']) || 0;
    if (existing && existing.totalSpent >= totalSpent) continue;

    membersByPhone.set(phone, {
      phone,
      name,
      email: row['Email']?.trim() || null,
      birthday: parseBirthday(row['Birthday']),
      tags,
      totalSpent,
      totalPoints: parseInt(row['Total Points']) || 0,
      totalTransactions: parseInt(row['Total Transactions']) || 0,
      lastPurchaseDate: parseDateMY(row['Last Purchase Date']),
    });
  }

  const members = Array.from(membersByPhone.values());
  console.log(`  Unique phones: ${members.length} (skipped ${skippedInvalid} invalid)`);

  // Step 2: Batch upsert members
  console.log('\nStep 2: Upserting members...');
  let memberErrors = 0;
  const ts = Date.now();

  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(members.length / BATCH_SIZE);

    const memberRows = batch.map((m, j) => ({
      id: `member-${ts}-${i + j}`,
      phone: m.phone,
      name: m.name,
      email: m.email,
      birthday: m.birthday,
      tags: m.tags,
    }));

    const { error } = await supabase
      .from('members')
      .upsert(memberRows, { onConflict: 'phone', ignoreDuplicates: false });

    if (error) {
      console.error(`\n  Batch ${batchNum} members error: ${error.message}`);
      memberErrors += batch.length;
    }

    process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} (${Math.min(i + BATCH_SIZE, members.length)}/${members.length})`);
  }
  console.log(`\n  Members upserted (${memberErrors} errors)`);

  // Step 3: Look up all member IDs by phone
  console.log('\nStep 3: Fetching member IDs...');
  const phoneToId = new Map<string, string>();

  for (let i = 0; i < members.length; i += 500) {
    const batch = members.slice(i, i + 500);
    const phones = batch.map(m => m.phone);

    const { data } = await supabase
      .from('members')
      .select('id, phone')
      .in('phone', phones);

    if (data) {
      for (const row of data) {
        phoneToId.set(row.phone, row.id);
      }
    }

    process.stdout.write(`\r  Fetched ${Math.min(i + 500, members.length)}/${members.length}`);
  }
  console.log(`\n  Found ${phoneToId.size} member IDs`);

  // Step 4: Batch upsert member_brands
  console.log('\nStep 4: Upserting member_brands...');
  let mbErrors = 0;

  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(members.length / BATCH_SIZE);

    const mbRows = batch
      .filter(m => phoneToId.has(m.phone))
      .map((m, j) => ({
        id: `mb-${ts}-${i + j}`,
        member_id: phoneToId.get(m.phone)!,
        brand_id: BRAND_ID,
        points_balance: m.totalPoints,
        total_points_earned: m.totalPoints,
        total_points_redeemed: 0,
        total_visits: m.totalTransactions,
        total_spent: m.totalSpent,
        last_visit_at: m.lastPurchaseDate,
      }));

    if (mbRows.length === 0) continue;

    const { error } = await supabase
      .from('member_brands')
      .upsert(mbRows, { onConflict: 'member_id,brand_id', ignoreDuplicates: false });

    if (error) {
      console.error(`\n  Batch ${batchNum} member_brands error: ${error.message}`);
      mbErrors += batch.length;
    }

    process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} (${Math.min(i + BATCH_SIZE, members.length)}/${members.length})`);
  }

  console.log(`\n  Member_brands upserted (${mbErrors} errors)`);

  // Summary
  console.log(`\n✅ Migration complete!`);
  console.log(`   Total CSV rows:     ${rows.length}`);
  console.log(`   Unique phones:      ${members.length}`);
  console.log(`   Member IDs found:   ${phoneToId.size}`);
  console.log(`   Invalid/skipped:    ${skippedInvalid}`);
  console.log(`   Member errors:      ${memberErrors}`);
  console.log(`   Member_brands errs: ${mbErrors}\n`);
}

const csvPath = process.argv[2] || '/tmp/storehub-export/Customers_FROM-celsiuscoffee_03292026_0224.csv';
migrate(csvPath).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
