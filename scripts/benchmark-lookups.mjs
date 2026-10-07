import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname } from "node:path";
import { requestLookup } from "../src/openai.ts";

// Run with `infisical run --env=dev -- npm run benchmark:lookups`.
// Never print or persist headers, environment variables, or the API key.
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Run this command through Infisical.");
const rounds = Number(process.env.BENCHMARK_ROUNDS ?? 2);
const outputPath = process.env.BENCHMARK_OUTPUT ?? "test-results/lookup-benchmark.json";
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error("BENCHMARK_ROUNDS must be between 1 and 5.");
const rates = {
  "gpt-4.1-mini": { input: 0.40, cached: 0.10, output: 1.60 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.60 },
  "gpt-4.1-nano": { input: 0.10, cached: 0.025, output: 0.40 },
  "gpt-5.5": { input: 5.00, cached: 0.50, output: 30.00 },
};
const allCases = [
  { id: "separable-verb", mode: "word", targetText: "belt", cueText: "Hij belt mij op." },
  { id: "compound", mode: "word", targetText: "straatlamp", cueText: "De straatlamp verlicht de donkere straat." },
  { id: "compound-linking-element", mode: "word", targetText: "boekenkast", cueText: "Zet het boek terug in de boekenkast." },
  { id: "simple-word", mode: "word", targetText: "hotel", cueText: "We slapen vannacht in een hotel." },
  { id: "idiom", mode: "selection", targetText: "rekening mee", cueText: "Daar moet je rekening mee houden." },
  { id: "sentence", mode: "sentence", targetText: "Als ik meer tijd had, zou ik vaker Nederlands oefenen.", cueText: "Als ik meer tijd had, zou ik vaker Nederlands oefenen." },
];
const requestedCases = process.env.BENCHMARK_CASES?.split(",");
const cases = requestedCases ? allCases.filter((sample) => requestedCases.includes(sample.id)) : allCases;
if (!cases.length || requestedCases?.some((id) => !allCases.some((sample) => sample.id === id))) throw new Error("Unknown BENCHMARK_CASES value.");

function redact(value) {
  return String(value).replaceAll(apiKey, "[redacted]").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}
function cost(model, usage) {
  if (!usage || !rates[model]) return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const rate = rates[model];
  return ((usage.input_tokens - cached) * rate.input + cached * rate.cached + usage.output_tokens * rate.output) / 1_000_000;
}

const nativeFetch = globalThis.fetch;
let activeCalls;
let reasoningOverride;
// Instrument the application's actual API path, including its truncation retry.
// Keep only safe response metadata needed to measure cost and latency.
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.openai.com/v1/responses") return nativeFetch(url, init);
  const body = JSON.parse(init.body);
  if (reasoningOverride) body.reasoning = { effort: reasoningOverride };
  const start = performance.now();
  const response = await nativeFetch(url, { ...init, body: JSON.stringify(body) });
  let data;
  try { data = await response.clone().json(); } catch { /* The application handles transport errors. */ }
  activeCalls?.push({
    model: body.model, reasoning: body.reasoning?.effort ?? "not applicable",
    httpStatus: response.status, status: data?.status,
    incompleteReason: data?.incomplete_details?.reason,
    durationMs: Math.round(performance.now() - start), usage: data?.usage,
    estimatedUsd: cost(body.model, data?.usage),
  });
  return response;
};

const modelResponse = await nativeFetch("https://api.openai.com/v1/models", {
  headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000),
});
if (!modelResponse.ok) throw new Error(`Model availability check failed (HTTP ${modelResponse.status}).`);
const available = new Set((await modelResponse.json()).data.map((model) => model.id));
const requestedModels = process.env.BENCHMARK_MODELS?.split(",") ?? Object.keys(rates);
if (requestedModels.some((model) => !rates[model])) throw new Error("Unknown BENCHMARK_MODELS value.");
const models = requestedModels.filter((model) => available.has(model));
const unavailable = Object.keys(rates).filter((model) => !available.has(model));
if (!models.length) throw new Error("None of the requested benchmark models are available.");
console.log(`Models: ${models.join(", ")}`);
if (unavailable.length) console.log(`Unavailable: ${unavailable.join(", ")}`);

const results = [];
const startedAt = new Date().toISOString();
async function measure(model, sample, round, effort) {
  const calls = [];
  activeCalls = calls;
  reasoningOverride = effort;
  const start = performance.now();
  let result;
  let error;
  try {
    result = await requestLookup(apiKey, {
      ...sample, model, targetLanguage: "Russian", cueId: sample.id,
      cueStartMs: 0, cueEndMs: 0,
    });
  } catch (cause) { error = redact(cause instanceof Error ? cause.message : cause); }
  const row = {
    model, variant: effort ? `${model} (${effort})` : model, caseId: sample.id,
    mode: sample.mode, round, durationMs: Math.round(performance.now() - start),
    result, error, calls,
    estimatedUsd: calls.reduce((sum, call) => sum + (call.estimatedUsd ?? 0), 0),
  };
  results.push(row);
  console.log(`${row.variant} | ${sample.id} | ${(row.durationMs / 1000).toFixed(2)}s | ${error ? `ERROR: ${error}` : result.translation}`);
  // Save after each request so an interrupted run retains completed measurements.
  await writeFile(outputPath, JSON.stringify({ startedAt, rounds, rates, cases, unavailable, results }, null, 2));
}

await mkdir(dirname(outputPath), { recursive: true });
for (let round = 1; round <= rounds; round++) {
  for (let index = 0; index < cases.length; index++) {
    // Rotate order to avoid making one model always benefit from a warm connection.
    const shift = (round + index) % models.length;
    const ordered = [...models.slice(shift), ...models.slice(0, shift)];
    for (const model of ordered) await measure(model, cases[index], round);
  }
}
if (process.env.BENCHMARK_REASONING_BASELINE === "1" && models.includes("gpt-5.5")) {
  for (let round = 1; round <= rounds; round++) {
    for (const sample of [allCases[0], allCases.at(-1)]) await measure("gpt-5.5", sample, round, "medium");
  }
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
console.log("\nSummary (end-to-end latency, including any retry):");
for (const variant of new Set(results.map((row) => row.variant))) {
  const rows = results.filter((row) => row.variant === variant);
  const successes = rows.filter((row) => row.result);
  console.log(`${variant}: ${successes.length}/${rows.length} successful; median ${(median(rows.map((row) => row.durationMs)) / 1000).toFixed(2)}s; estimated $${rows.reduce((sum, row) => sum + row.estimatedUsd, 0).toFixed(5)}; ${rows.reduce((sum, row) => sum + Math.max(0, row.calls.length - 1), 0)} retries`);
}
console.log(`Safe results saved to ${outputPath}. Costs use published standard rates; timed-out calls without usage may still be billed.`);
