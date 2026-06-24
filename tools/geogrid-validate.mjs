#!/usr/bin/env node
/**
 * Geogrid validation — run a real Places-API rank sweep for ONE outlet/keyword
 * without deploying. Mirrors apps/backoffice/src/lib/seo/geogrid.ts.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=xxx node tools/geogrid-validate.mjs <outlet> "<keyword>" [--quick]
 *
 *   <outlet>   one of: nilai | putrajaya | shah-alam | tamarind
 *   <keyword>  e.g. "coffee near me"
 *   --quick    3-ring spot check (centre + 1km + 3km on 4 bearings = 9 calls)
 *              instead of the full N×N grid (~81 calls). Cheaper sanity check.
 *
 * Coordinates are the live values from the Outlet table (project
 * kqdcdhpnyuwrxqhbuyfl, fetched 2026-06-24). Brand match falls back to the
 * displayName because gbpPlaceId isn't stored yet.
 */

const BRAND_MATCH = "celsius";
const NOT_FOUND_RANK = 21;
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

// Live outlet coords + per-outlet grid (matches geogrid-config.ts defaults).
const OUTLETS = {
  nilai: { name: "Celsius Coffee Nilai", lat: 2.8105569, lng: 101.7964669, gridSize: 9, spacingKm: 1.2, biasRadiusM: 1500 },
  putrajaya: { name: "Celsius Coffee Putrajaya", lat: 2.9375, lng: 101.7156, gridSize: 9, spacingKm: 1.5, biasRadiusM: 1800 },
  "shah-alam": { name: "Celsius Coffee Shah Alam", lat: 3.0733, lng: 101.5185, gridSize: 9, spacingKm: 1.2, biasRadiusM: 1500 },
  tamarind: { name: "Celsius Coffee Tamarind", lat: 2.9264, lng: 101.6553, gridSize: 9, spacingKm: 1.2, biasRadiusM: 1500 },
};

const KM_PER_DEG_LAT = 110.574;

function buildGrid(lat, lng, size, spacingKm) {
  const half = (size - 1) / 2;
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const cells = [];
  for (let row = 0; row < size; row++) {
    const dNorthKm = (half - row) * spacingKm;
    for (let col = 0; col < size; col++) {
      const dEastKm = (col - half) * spacingKm;
      cells.push({
        row,
        col,
        lat: lat + dNorthKm / KM_PER_DEG_LAT,
        lng: lng + dEastKm / kmPerDegLng,
        distKm: Math.hypot(dNorthKm, dEastKm),
      });
    }
  }
  return cells;
}

// Centre + 1km/3km on N/E/S/W — cheap spot check.
function quickPoints(lat, lng) {
  const out = [{ row: 0, col: 0, lat, lng, distKm: 0 }];
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (const d of [1, 3]) {
    out.push({ lat: lat + d / KM_PER_DEG_LAT, lng, distKm: d, label: `${d}km N` });
    out.push({ lat: lat - d / KM_PER_DEG_LAT, lng, distKm: d, label: `${d}km S` });
    out.push({ lat, lng: lng + d / kmPerDegLng, distKm: d, label: `${d}km E` });
    out.push({ lat, lng: lng - d / kmPerDegLng, distKm: d, label: `${d}km W` });
  }
  return out;
}

async function rankAt(keyword, lat, lng, biasRadiusM, apiKey) {
  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({
      textQuery: keyword,
      maxResultCount: 20,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: biasRadiusM } },
    }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${await res.text()}`);
  const places = (await res.json()).places ?? [];
  const idx = places.findIndex((p) => (p.displayName?.text ?? "").toLowerCase().includes(BRAND_MATCH));
  return { rank: idx === -1 ? null : idx + 1, top: places[0]?.displayName?.text ?? "(none)" };
}

function median(nums) {
  if (!nums.length) return NOT_FOUND_RANK;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const [outletKey, keyword, ...flags] = process.argv.slice(2);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const outlet = OUTLETS[outletKey];

  if (!apiKey) return fail("Set GOOGLE_PLACES_API_KEY in the environment.");
  if (!outlet || !keyword) return fail(`Usage: node tools/geogrid-validate.mjs <${Object.keys(OUTLETS).join("|")}> "<keyword>" [--quick]`);

  const quick = flags.includes("--quick");
  const points = quick
    ? quickPoints(outlet.lat, outlet.lng)
    : buildGrid(outlet.lat, outlet.lng, outlet.gridSize, outlet.spacingKm);

  console.log(`\n${outlet.name} — "${keyword}" — ${quick ? "quick 9-point" : `${outlet.gridSize}×${outlet.gridSize}`} sweep (${points.length} calls)\n`);

  const ranked = [];
  for (const p of points) {
    const { rank, top } = await rankAt(keyword, p.lat, p.lng, outlet.biasRadiusM, apiKey);
    ranked.push({ ...p, rank });
    if (quick) console.log(`  ${(p.label ?? "centre").padEnd(8)} → rank ${rank ?? "—"}   (top: ${top})`);
  }

  // Metrics
  const eff = (c) => c.rank ?? NOT_FOUND_RANK;
  const atrp = ranked.reduce((s, c) => s + eff(c), 0) / ranked.length;
  const solv = (ranked.filter((c) => c.rank != null && c.rank <= 3).length / ranked.length) * 100;
  const radii = [...new Set(ranked.map((c) => Number(c.distKm.toFixed(3))))].sort((a, b) => a - b);
  let oneReach = 0;
  for (const r of radii) {
    if (median(ranked.filter((c) => c.distKm <= r + 1e-9).map(eff)) === 1) oneReach = r;
    else break;
  }

  if (!quick) {
    const size = outlet.gridSize;
    console.log("  grid (rank per cell, · = not in top 20):\n");
    for (let row = 0; row < size; row++) {
      const line = ranked.filter((c) => c.row === row).sort((a, b) => a.col - b.col)
        .map((c) => String(c.rank ?? "·").padStart(3)).join(" ");
      console.log("   " + line);
    }
  }

  console.log(`\n  #1-reach: ${oneReach.toFixed(2)} km   SoLV(top-3): ${solv.toFixed(0)}%   ATRP: ${atrp.toFixed(1)}   found: ${ranked.filter((c) => c.rank != null).length}/${ranked.length}\n`);
  if (ranked.every((c) => c.rank == null)) {
    console.log("  ⚠ Not found in ANY cell. Either we're off the board for this keyword, or the");
    console.log("    brand-name match missed — check the 'top' lines above for our real listing name.\n");
  }
}

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

main().catch((e) => fail(e.message));
