/**
 * Startup env-var validation for the staff app.
 * Imported for side effects from instrumentation.ts.
 */
import { z } from "zod";
import { parseEnv } from "@celsius/shared";

const schema = z.object({
  // Core — app crashes at boot if these are missing
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),

  // Supabase (file uploads, HR integration)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // AI (expense-claim extraction, audit insights)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Vercel cron (reset-checklists)
  CRON_SECRET: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export const env = parseEnv(schema);
