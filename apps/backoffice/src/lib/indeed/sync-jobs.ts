/**
 * Sync Indeed Sponsored Jobs into indeed_ads_job + indeed_ads_metric_daily.
 *
 * Indeed Sponsored Jobs API base URL is `https://apis.indeed.com/ads`
 * (handled in client.ts). Endpoints used:
 *
 *   GET /v1/campaigns
 *     → { data: { Campaigns: [{ Id, Name, Status, ... }] } }
 *
 *   GET /v1/campaigns/{campaignId}/jobDetails
 *     → { data: { Jobs: [{ JobKey, JobTitle, JobLocation, Status, ... }] } }
 *
 *   GET /v1/campaigns/{campaignId}/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *     → { data: { Stats: [{ Date, Impressions, Clicks, ApplyStarts, Applies, Spend }] } }
 *
 * (Per-job daily stats are not available to direct employers — Indeed only
 *  exposes per-campaign daily breakdowns. We attribute the campaign daily
 *  spend to its single job by default, or split it evenly if a campaign
 *  has multiple jobs.)
 *
 * Writes are idempotent — upsert by (indeedJobId) for jobs, by
 * (date, jobId) for daily metrics.
 */

import { prisma } from "@/lib/prisma";
import { indeedFetch } from "./client";
import { resolveOutletId } from "./outlet-map";

type IndeedListResponse<K extends string, T> = {
  meta?: { status?: number };
  data: Record<K, T[]>;
};

type RawCampaign = {
  Id:     string;
  Name?:  string;
  Status?: string;
};

type RawJob = {
  JobKey:        string;
  JobTitle?:     string;
  JobLocation?:  { City?: string; State?: string; Country?: string } | string;
  Status?:       string;
  Premium?:      boolean;
};

type RawStat = {
  Date:          string; // YYYY-MM-DD
  Impressions?:  number;
  Clicks?:       number;
  ApplyStarts?:  number;
  Applies?:      number;
  Spend?:        number; // USD
};

export type SyncResult = {
  campaignsSeen:   number;
  jobsUpserted:    number;
  metricsUpserted: number;
};

export async function syncIndeed(opts: { from?: Date; to?: Date } = {}): Promise<SyncResult> {
  const to   = opts.to   ?? new Date();
  const from = opts.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromStr = formatDate(from);
  const toStr   = formatDate(to);

  let campaignsSeen = 0;
  let jobsUpserted  = 0;
  let metricsUpserted = 0;

  const campaignsRes = await indeedFetch<IndeedListResponse<"Campaigns", RawCampaign>>("/v1/campaigns");
  const campaigns = campaignsRes.data?.Campaigns ?? [];
  campaignsSeen = campaigns.length;

  for (const campaign of campaigns) {
    // 1. List jobs in the campaign so we know what to attribute spend to.
    let jobs: RawJob[] = [];
    try {
      const r = await indeedFetch<IndeedListResponse<"Jobs", RawJob>>(`/v1/campaigns/${campaign.Id}/jobDetails`);
      jobs = r.data?.Jobs ?? [];
    } catch (err) {
      console.warn(`[indeed] campaign ${campaign.Id} jobDetails fetch failed:`, err);
      continue;
    }

    if (jobs.length === 0) continue;

    // Upsert each job row.
    const dbJobs: Array<{ id: string; indeedJobId: string }> = [];
    for (const job of jobs) {
      const loc = typeof job.JobLocation === "object" ? job.JobLocation : null;
      const city  = loc?.City ?? null;
      const state = loc?.State ?? null;
      const outletId = await resolveOutletId(city);

      const upserted = await prisma.indeedAdsJob.upsert({
        where:  { indeedJobId: job.JobKey },
        create: {
          indeedJobId:   job.JobKey,
          campaignId:    campaign.Id,
          campaignName:  campaign.Name ?? null,
          title:         job.JobTitle ?? "(untitled)",
          locationCity:  city,
          locationState: state,
          outletId,
          status:        job.Status,
          premium:       job.Premium ?? false,
        },
        update: {
          campaignId:    campaign.Id,
          campaignName:  campaign.Name ?? null,
          title:         job.JobTitle ?? "(untitled)",
          locationCity:  city,
          locationState: state,
          // Preserve manual outlet overrides — only auto-set on first insert.
          status:        job.Status,
          premium:       job.Premium ?? false,
          lastSyncedAt:  new Date(),
        },
      });
      dbJobs.push({ id: upserted.id, indeedJobId: job.JobKey });
      jobsUpserted++;
    }

    // 2. Get campaign daily stats over the window in one call.
    let stats: RawStat[] = [];
    try {
      const r = await indeedFetch<IndeedListResponse<"Stats", RawStat>>(
        `/v1/campaigns/${campaign.Id}/stats?startDate=${fromStr}&endDate=${toStr}`,
      );
      stats = r.data?.Stats ?? [];
    } catch (err) {
      console.warn(`[indeed] campaign ${campaign.Id} stats fetch failed:`, err);
      continue;
    }

    // Attribute campaign-level daily spend evenly across the campaign's jobs.
    // (Indeed exposes per-campaign daily breakdowns, not per-job daily.)
    const share = 1 / dbJobs.length;
    for (const stat of stats) {
      const date = new Date(stat.Date + "T00:00:00Z");
      for (const dbJob of dbJobs) {
        const impressions = Math.round((stat.Impressions ?? 0) * share);
        const clicks      = Math.round((stat.Clicks      ?? 0) * share);
        const applyStarts = Math.round((stat.ApplyStarts ?? 0) * share);
        const applies     = Math.round((stat.Applies     ?? 0) * share);
        const spend       = (stat.Spend ?? 0) * share;

        await prisma.indeedAdsMetricDaily.upsert({
          where:  { date_jobId: { date, jobId: dbJob.id } },
          create: {
            date,
            jobId:        dbJob.id,
            impressions:  BigInt(impressions),
            clicks:       BigInt(clicks),
            applyStarts:  BigInt(applyStarts),
            applies:      BigInt(applies),
            spendUsd:     spend.toFixed(2),
            costPerClick: clicks  > 0 ? +(spend / clicks ).toFixed(4) : null,
            costPerApply: applies > 0 ? +(spend / applies).toFixed(4) : null,
          },
          update: {
            impressions:  BigInt(impressions),
            clicks:       BigInt(clicks),
            applyStarts:  BigInt(applyStarts),
            applies:      BigInt(applies),
            spendUsd:     spend.toFixed(2),
            costPerClick: clicks  > 0 ? +(spend / clicks ).toFixed(4) : null,
            costPerApply: applies > 0 ? +(spend / applies).toFixed(4) : null,
            syncedAt:     new Date(),
          },
        });
        metricsUpserted++;
      }
    }
  }

  return { campaignsSeen, jobsUpserted, metricsUpserted };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
