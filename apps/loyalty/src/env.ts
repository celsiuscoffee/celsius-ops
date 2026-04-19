/**
 * Startup env-var validation for the loyalty app.
 * Imported for side effects from instrumentation.ts.
 */
import { z } from "zod";
import { parseEnv } from "@celsius/shared";

const schema = z.object({
  // Core — app crashes at boot if these are missing
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),

  // Supabase (primary data store for loyalty members)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // StoreHub (POS sync)
  STOREHUB_API_URL: z.string().url().optional(),
  STOREHUB_USERNAME: z.string().optional(),
  STOREHUB_API_KEY: z.string().optional(),

  // SMS
  SMS123_API_KEY: z.string().optional(),
  SMS123_EMAIL: z.string().optional(),
  SMS_PROVIDER: z.string().optional(),

  // Vercel cron
  CRON_SECRET: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export const env = parseEnv(schema);
