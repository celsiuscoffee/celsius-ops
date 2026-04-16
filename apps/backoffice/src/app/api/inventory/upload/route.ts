import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL || "";
const supabaseKey = process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string | null) ?? "invoices";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const buffer = Buffer.from(await file.arrayBuffer());
    const isPdf = file.type === "application/pdf";
    const ext = isPdf ? "pdf" : file.name.split(".").pop() || "jpg";
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // Ensure bucket exists
    const bucketName = "invoices";
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === bucketName)) {
      await supabase.storage.createBucket(bucketName, { public: true });
    }

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, buffer, {
        contentType: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
        upsert: true,
      });

    if (uploadError) {
      console.error("[upload] Supabase error:", uploadError.message);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);

    return NextResponse.json({
      url: urlData.publicUrl,
      type: isPdf ? "pdf" : "image",
      name: file.name,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[upload] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
