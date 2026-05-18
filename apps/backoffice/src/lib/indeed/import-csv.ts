/**
 * Parse Indeed analytics CSV export and upsert into our DB.
 *
 * The Sponsored Jobs API does not expose dashboard-managed recruitment
 * spend (Indeed has two parallel products — API-managed and self-service).
 * The user's actual spend lives in the self-service product, so we ingest
 * monthly via CSV exports from
 *   employers.indeed.com/analytics/report-jobs-campaigns
 * → "View by Job" → Export.
 *
 * The parser is column-name driven, not position-driven, so it tolerates
 * Indeed re-ordering or adding columns. Required columns (case-insensitive):
 *   - "Job" or "Job title"  (for the posting name)
 *   - "Spend"               (USD amount)
 * Optional:
 *   - "Location" / "City"
 *   - "Campaign" / "Campaign name"
 *   - "Impressions", "Clicks", "Apply starts", "Applies"
 *   - "Job ID" / "Job key"  (else we derive a stable ID from title+city)
 */

import { prisma } from "@/lib/prisma";
import { resolveOutletId } from "./outlet-map";
import { createHash } from "crypto";

export type CsvImportResult = {
  rowsParsed:      number;
  jobsUpserted:    number;
  metricsUpserted: number;
  errors:          string[];
};

export async function importIndeedCsv(args: {
  csvText:     string;
  periodStart: Date;
  periodEnd:   Date;
}): Promise<CsvImportResult> {
  const { csvText, periodStart, periodEnd } = args;
  const errors: string[] = [];

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { rowsParsed: 0, jobsUpserted: 0, metricsUpserted: 0, errors: ["CSV has no rows"] };
  }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  const idx = (...names: string[]): number => {
    for (const name of names) {
      const i = headers.indexOf(name.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const colTitle    = idx("job", "job title", "title", "posting");
  const colSpend    = idx("spend", "cost", "amount");
  const colLoc      = idx("location", "city", "job location");
  const colCampaign = idx("campaign", "campaign name", "campaigns");
  const colJobId    = idx("job id", "job key", "jobkey", "id");
  const colImp      = idx("impressions");
  const colClicks   = idx("clicks");
  const colApplyStarts = idx("apply starts", "applystarts");
  const colApplies  = idx("applies");

  if (colTitle === -1) {
    return { rowsParsed: dataRows.length, jobsUpserted: 0, metricsUpserted: 0,
             errors: [`Required column "Job" / "Job title" not found. Got: ${headers.join(", ")}`] };
  }
  if (colSpend === -1) {
    return { rowsParsed: dataRows.length, jobsUpserted: 0, metricsUpserted: 0,
             errors: [`Required column "Spend" not found. Got: ${headers.join(", ")}`] };
  }

  let jobsUpserted = 0;
  let metricsUpserted = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (row.every(c => c.trim() === "")) continue;

    const title = (row[colTitle] ?? "").trim();
    if (!title || /total/i.test(title)) continue; // skip totals row

    const spendStr = (row[colSpend] ?? "0").replace(/[$,\s]/g, "");
    const spend = parseFloat(spendStr) || 0;

    const locationRaw = colLoc >= 0 ? (row[colLoc] ?? "").trim() : "";
    const city  = locationRaw.split(",")[0]?.trim() || null;
    const state = locationRaw.split(",").slice(1).join(",").trim() || null;
    const outletId = await resolveOutletId(city);

    const campaignName = colCampaign >= 0 ? (row[colCampaign] ?? "").trim() || null : null;
    const explicitJobId = colJobId >= 0 ? (row[colJobId] ?? "").trim() : "";
    const indeedJobId = explicitJobId || stableId(title, locationRaw);

    const impressions = colImp     >= 0 ? parseIntSafe(row[colImp])    : 0;
    const clicks      = colClicks  >= 0 ? parseIntSafe(row[colClicks]) : 0;
    const applyStarts = colApplyStarts >= 0 ? parseIntSafe(row[colApplyStarts]) : 0;
    const applies     = colApplies >= 0 ? parseIntSafe(row[colApplies]) : 0;

    try {
      const job = await prisma.indeedAdsJob.upsert({
        where:  { indeedJobId },
        create: {
          indeedJobId,
          campaignName,
          title,
          locationCity:  city,
          locationState: state,
          outletId,
          status:        "OPEN",
          premium:       false,
        },
        update: {
          campaignName,
          title,
          locationCity:  city,
          locationState: state,
          // Preserve manual outlet overrides; auto-attach only on create.
          status:        "OPEN",
          lastSyncedAt:  new Date(),
        },
      });
      jobsUpserted++;

      // Single metric row at period_end. Re-importing the same period
      // overwrites cleanly via the (date, jobId) unique constraint.
      await prisma.indeedAdsMetricDaily.upsert({
        where:  { date_jobId: { date: periodEnd, jobId: job.id } },
        create: {
          date:        periodEnd,
          jobId:       job.id,
          impressions: BigInt(impressions),
          clicks:      BigInt(clicks),
          applyStarts: BigInt(applyStarts),
          applies:     BigInt(applies),
          spendUsd:    spend.toFixed(2),
          costPerClick: clicks  > 0 ? +(spend / clicks ).toFixed(4) : null,
          costPerApply: applies > 0 ? +(spend / applies).toFixed(4) : null,
        },
        update: {
          impressions: BigInt(impressions),
          clicks:      BigInt(clicks),
          applyStarts: BigInt(applyStarts),
          applies:     BigInt(applies),
          spendUsd:    spend.toFixed(2),
          costPerClick: clicks  > 0 ? +(spend / clicks ).toFixed(4) : null,
          costPerApply: applies > 0 ? +(spend / applies).toFixed(4) : null,
          syncedAt:    new Date(),
        },
      });
      metricsUpserted++;
    } catch (err) {
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Silence the unused-variable warning for periodStart while still
  // accepting it for future support (e.g. spreading spend evenly across
  // the period's days instead of pinning at periodEnd).
  void periodStart;

  return { rowsParsed: dataRows.length, jobsUpserted, metricsUpserted, errors };
}

function stableId(title: string, locationRaw: string): string {
  return "csv-" + createHash("sha1").update(`${title}|${locationRaw}`).digest("hex").slice(0, 24);
}

function parseIntSafe(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Minimal CSV parser supporting quoted fields and embedded commas/quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuote = false;
      else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",")  { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip — handled by \n */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
