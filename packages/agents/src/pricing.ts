// Single source of truth for per-token model pricing, used for both the
// expected-cost estimates on the /agents registry and the actual cost logged
// to agent_actions from real API usage. Update rates here only - the DB stores
// token estimates, never dollar amounts, so a price change never leaves stale
// numbers behind.
//
// Rates are USD per 1,000,000 tokens (input / output), from the Anthropic
// pricing table (claude-api skill, cached 2026-06-24). Cache multipliers:
// read ~0.1x input, 5-min write ~1.25x input, 1-hour write ~2x input.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const PRICING: Record<string, ModelPrice> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  // Sonnet 4.5 is not in the current pricing table; priced at the Sonnet tier.
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// Normalize date-suffixed / unknown IDs to their base rate; falls back to the
// Sonnet tier for an unrecognized model so a new model never silently prices
// at zero.
function rateFor(model: string | null | undefined): ModelPrice {
  if (!model) return PRICING["claude-sonnet-4-6"];
  if (PRICING[model]) return PRICING[model];
  const base = Object.keys(PRICING).find((k) => model.startsWith(k));
  return base ? PRICING[base] : PRICING["claude-sonnet-4-6"];
}

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// Cost in USD for a given token profile on a model. Non-LLM agents pass no
// model / zero tokens and get 0.
export function estimateCostUsd(model: string | null | undefined, t: TokenCounts): number {
  if (!model) return 0;
  const r = rateFor(model);
  const input = (t.inputTokens ?? 0) * r.inputPerMTok;
  const output = (t.outputTokens ?? 0) * r.outputPerMTok;
  const cacheRead = (t.cacheReadTokens ?? 0) * r.inputPerMTok * CACHE_READ_MULT;
  const cacheWrite = (t.cacheWriteTokens ?? 0) * r.inputPerMTok * CACHE_WRITE_MULT;
  return (input + output + cacheRead + cacheWrite) / 1_000_000;
}

// Anthropic SDK usage object -> { inputTokens, outputTokens, costUsd }, ready to
// pass to logAgentAction. Reads cache fields when present.
export function costFromUsage(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null | undefined,
): { inputTokens: number; outputTokens: number; costUsd: number } {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
}
