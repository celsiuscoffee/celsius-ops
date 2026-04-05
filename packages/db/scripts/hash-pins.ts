#!/usr/bin/env npx tsx
/**
 * One-time migration: Hash all plaintext PINs to bcrypt.
 *
 * Usage:
 *   cd packages/db && npx tsx scripts/hash-pins.ts
 *
 * Safe to run multiple times — skips already-hashed PINs.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

async function main() {
  const users = await prisma.user.findMany({
    where: { pin: { not: null } },
    select: { id: true, name: true, pin: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.pin) continue;

    // Already hashed (bcrypt)
    if (user.pin.startsWith("$2")) {
      skipped++;
      continue;
    }

    // Plaintext — hash it
    const hashed = await bcrypt.hash(user.pin, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: { pin: hashed },
    });
    console.log(`  ✓ ${user.name} — PIN hashed`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Already hashed: ${skipped}, Total: ${users.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
