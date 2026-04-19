/**
 * Startup env-var validation for the order app.
 * Imported for side effects from instrumentation.ts.
 */
import { z } from "zod";
import { parseEnv } from "@celsius/shared";

const schema = z.object({
  // Core — app crashes at boot if these are missing
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),

  // Supabase (customer OAuth + data queries)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Payments — Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Payments — Revenue Monster (optional, per-outlet config)
  RM_BASE_URL: z.string().optional(),
  RM_CLIENT_ID: z.string().optional(),
  RM_CLIENT_SECRET: z.string().optional(),
  RM_STORE_ID: z.string().optional(),

  // Loyalty API calls
  LOYALTY_BASE_URL: z.string().url().optional(),
  LOYALTY_BRAND_ID: z.string().optional(),

  // StoreHub menu sync
  STOREHUB_API_URL: z.string().url().optional(),
  STOREHUB_USERNAME: z.string().optional(),
  STOREHUB_API_KEY: z.string().optional(),

  // Web Push (VAPID)
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().optional(),

  // Image uploads
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Misc
  NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export const env = parseEnv(schema);
