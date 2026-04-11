/**
 * Edge-compatible auth helpers — re-exports from @celsius/auth.
 *
 * Previously this file contained a standalone edge-safe copy of JWT verification.
 * Now it re-exports from the shared package. The imports used here (verifyToken,
 * COOKIE_NAME) only depend on jose, which is fully edge-compatible.
 */

export { verifyToken, COOKIE_NAME } from "@/lib/auth";
export type { SessionUser } from "@/lib/auth";
