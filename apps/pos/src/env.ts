/**
 * Startup env-var validation for the pos app.
 * Imported for side effects from instrumentation.ts.
 */
import { z } from "zod";
import { parseEnv } from "@celsius/shared";

const schema = z.object({
  // Core — app crashes at boot if these are missing
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  // Supabase (menu + loyalty integration)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Revenue Monster (payment terminal)
  RM_ENV: z.enum(["sandbox", "production"]).optional(),
  RM_CLIENT_ID: z.string().optional(),
  RM_CLIENT_SECRET: z.string().optional(),
  RM_PRIVATE_KEY: z.string().optional(),
  RM_TERMINAL_ID: z.string().optional(),

  // Grab Food (delivery integration)
  GRAB_ENV: z.enum(["sandbox", "production"]).optional(),
  GRAB_CLIENT_ID: z.string().optional(),
  GRAB_CLIENT_SECRET: z.string().optional(),
  GRAB_MERCHANT_ID: z.string().optional(),

  // Delivery webhook auth
  DELIVERY_WEBHOOK_SECRET: z.string().optional(),

  // Legacy inventory Supabase (deprecated but referenced)
  LEGACY_INVENTORY_SUPABASE_URL: z.string().url().optional(),
  LEGACY_INVENTORY_SUPABASE_ANON_KEY: z.string().optional(),

  // Fallback outlet for webhooks that don't identify one
  DEFAULT_OUTLET_ID: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export const env = parseEnv(schema);
