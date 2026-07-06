import { NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Daily cron — fires reminder memos to staff (and HR copy) when certs are
// approaching expiry. Three nag stages: 30, 14, 7 days out, plus an
// "expired today" memo at stage=expired so HR has a paper trail.
//
// Idempotent via hr_certification_reminders unique(certification_id, stage).
//
// Auth: Bearer CRON_SECRET.
async function runCertExpiryReminders() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const isoToday = today.toISOString().slice(0, 10);

  // Pull all certs with an expiry within 30 days (or already expired today).
  const horizon = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: certs, error } = await hrSupabaseAdmin
    .from("hr_certifications")
    .select("id, user_id, cert_type, name, expires_at")
    .not("expires_at", "is", null)
    .lte("expires_at", horizon);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch all reminders we've already sent so we don't double-notify.
  const certIds = (certs || []).map((c: { id: string }) => c.id);
  const { data: sentReminders } = certIds.length
    ? await hrSupabaseAdmin
        .from("hr_certification_reminders")
        .select("certification_id, stage")
        .in("certification_id", certIds)
    : { data: [] as Array<{ certification_id: string; stage: string }> };
  const sentSet = new Set((sentReminders || []).map((r) => `${r.certification_id}:${r.stage}`));

  type Stage = "30d" | "14d" | "7d" | "expired";
  const dueReminders: Array<{ cert: { id: string; user_id: string; cert_type: string; name: string; expires_at: string }; stage: Stage; days: number }> = [];

  for (const c of (certs || []) as Array<{ id: string; user_id: string; cert_type: string; name: string; expires_at: string }>) {
    const exp = new Date(c.expires_at + "T00:00:00Z");
    const days = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
    let stage: Stage | null = null;
    // Pick the most-urgent stage that hasn't fired yet.
    if (days < 0 && !sentSet.has(`${c.id}:expired`)) stage = "expired";
    else if (days >= 0 && days <= 7 && !sentSet.has(`${c.id}:7d`)) stage = "7d";
    else if (days > 7 && days <= 14 && !sentSet.has(`${c.id}:14d`)) stage = "14d";
    else if (days > 14 && days <= 30 && !sentSet.has(`${c.id}:30d`)) stage = "30d";
    if (stage) dueReminders.push({ cert: c, stage, days });
  }

  // Idempotency: write the reminder marker FIRST, relying on the unique
  // (certification_id, stage) constraint to prevent dup memos. Only if the
  // marker insert succeeds (i.e. we're the first run that day) do we
  // actually send the memo. If the memo insert fails, the marker stays
  // (slightly leaky), but we never double-notify the user — which is the
  // worse failure mode for cert reminders.
  let memosCreated = 0;
  for (const r of dueReminders) {
    const { error: markerErr } = await hrSupabaseAdmin
      .from("hr_certification_reminders")
      .insert({ certification_id: r.cert.id, stage: r.stage });
    if (markerErr) continue; // unique violation = already sent, skip

    const isExpired = r.stage === "expired";
    const titleStub = isExpired
      ? `EXPIRED: ${r.cert.name}`
      : `Renew your ${r.cert.name} (${r.days} days left)`;
    const bodyStub = isExpired
      ? `Your ${r.cert.name} expired on ${r.cert.expires_at}. You must not work with food until renewed. Please contact HR with the renewal certificate ASAP.`
      : `Your ${r.cert.name} expires on ${r.cert.expires_at} (${r.days} days from today). Please book the renewal and upload the new certificate to HR before then.`;

    const { error: memoErr } = await hrSupabaseAdmin
      .from("hr_memos")
      .insert({
        user_id: r.cert.user_id,
        user_ids: [r.cert.user_id],
        issued_by: null,         // system-generated
        type: "reminder",
        severity: isExpired ? "major" : r.stage === "7d" ? "minor" : "info",
        title: titleStub,
        body: bodyStub,
        related_type: "certification",
        related_id: r.cert.id,
        status: "active",
      });
    if (!memoErr) memosCreated++;
  }

  return NextResponse.json({
    today: isoToday,
    certs_in_window: (certs || []).length,
    reminders_sent: memosCreated,
    breakdown: dueReminders.reduce<Record<string, number>>((m, r) => {
      m[r.stage] = (m[r.stage] || 0) + 1;
      return m;
    }, {}),
  });
}

export const GET = cronRoute("cert-expiry-reminders", runCertExpiryReminders);
