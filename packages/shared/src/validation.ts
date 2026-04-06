/**
 * Shared API route validation helper.
 * Wraps a route handler with Zod parsing + error catching.
 *
 * Usage:
 *   import { z } from "zod";
 *   import { validated } from "@celsius/shared/validation";
 *
 *   const schema = z.object({ name: z.string().min(1) });
 *
 *   export const POST = validated(schema, async (data, req) => {
 *     // data is typed and validated
 *     return NextResponse.json({ ok: true });
 *   });
 */
import { NextRequest, NextResponse } from "next/server";
import type { ZodSchema, z } from "zod";

export function validated<T extends ZodSchema>(
  schema: T,
  handler: (data: z.infer<T>, req: NextRequest) => Promise<Response>,
) {
  return async (req: NextRequest) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      const firstError = result.error.issues[0];
      return NextResponse.json(
        {
          error: firstError?.message || "Validation failed",
          field: firstError?.path?.join("."),
        },
        { status: 400 },
      );
    }

    try {
      return await handler(result.data, req);
    } catch (error) {
      console.error("[API Error]", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}
