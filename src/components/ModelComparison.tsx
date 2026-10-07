import { Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { requestLookup } from "../openai";
import type { AppSettings, LookupMode, LookupResult } from "../types";

// Standard USD rates per million tokens, checked against official model pages
// on 2026-10-07. Links stay next to prices so they can be checked as rates change.
const MODELS = [
  { id: "gpt-4.1-mini", label: "Balanced", input: 0.40, output: 1.60 },
  { id: "gpt-4o-mini", label: "Budget", input: 0.15, output: 0.60 },
  { id: "gpt-4.1-nano", label: "Lowest cost · experimental", input: 0.10, output: 0.40 },
  { id: "gpt-5.5", label: "Previous default", input: 5.00, output: 30.00 },
];

type Sample = { mode: LookupMode; durationMs: number; result?: LookupResult; error?: string };
type Measurement = { model: string; samples: Sample[] };
const PASSAGE = "Hij belt mij op, maar ik neem niet op.";

export function ModelComparison({ settings, onChange, open }: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  open: boolean;
}) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [running, setRunning] = useState(false);
  const [language, setLanguage] = useState("");
  const controllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort();
      setRunning(false);
    }
    return () => controllerRef.current?.abort();
  }, [open, settings.apiKey, settings.customPrompt, settings.targetLanguage]);

  async function compare() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMeasurements([]);
    setLanguage(settings.targetLanguage);
    // Sequential requests avoid timing models while they compete with each
    // other on the same connection. Cache is deliberately bypassed.
    const rows: Measurement[] = [];
    try {
      for (const model of MODELS) {
        const row: Measurement = { model: model.id, samples: [] };
        rows.push(row);
        for (const mode of ["word", "sentence"] as const) {
          const start = performance.now();
          let result: LookupResult | undefined;
          let error: string | undefined;
          try {
            result = await requestLookup(settings.apiKey, {
              model: model.id, targetLanguage: settings.targetLanguage,
              targetText: mode === "word" ? "belt" : PASSAGE,
              cueText: PASSAGE, cueId: "comparison", cueStartMs: 0, cueEndMs: 0, mode,
            }, { customPrompt: settings.customPrompt, signal: controller.signal });
          } catch (cause) {
            if (controller.signal.aborted) return;
            error = cause instanceof Error ? cause.message : "Comparison failed.";
          }
          if (controller.signal.aborted) return;
          row.samples.push({ mode, durationMs: performance.now() - start, result, error });
          setMeasurements(rows.map((item) => ({ ...item, samples: [...item.samples] })));
        }
      }
    } finally {
      if (controllerRef.current === controller) setRunning(false);
    }
  }

  return (
    <Flex direction="column" gap="2" aria-label="Model comparison">
      <Text size="2" weight="bold">Translation models</Text>
      {MODELS.map((model) => (
        <Flex key={model.id} gap="2" justify="between" align="center" wrap="wrap">
          <Text size="1">
            <a href={`https://developers.openai.com/api/docs/models/${model.id}`} target="_blank" rel="noreferrer">{model.id}</a>
            {" · "}{model.label}{" · "}${model.input.toFixed(2)} / ${model.output.toFixed(2)}
          </Text>
          <Button size="1" variant="soft" disabled={settings.model === model.id} onClick={() => onChange({ ...settings, model: model.id })}>
            Use {model.id}
          </Button>
        </Flex>
      ))}
      <Text size="1" color="gray">USD per 1M input / output tokens, checked October 7, 2026. These presets skip reasoning for quick translations.</Text>
      <Text size="1" color="gray">GPT-4.1 mini is the default. Nano can miss contextual meanings and word-parts explanations; compare quality before switching.</Text>
      <Text size="1" color="gray">
        Compare one word and one sentence per model in your target language: normally 8 billed requests, without cached answers. Truncated replies get one retry. Compare translations and times; one run is a sample, not an average.
      </Text>
      <Flex gap="2">
        <Button variant="surface" disabled={running || !settings.apiKey.trim()} onClick={() => void compare()}>
          {running ? <Spinner /> : null} Compare speed
        </Button>
        {running ? <Button variant="soft" onClick={() => { controllerRef.current?.abort(); setRunning(false); }}>Stop comparison</Button> : null}
      </Flex>
      {measurements.length ? (
        <Flex direction="column" gap="2" aria-live="polite">
          <Text size="1" color="gray">Sample passage: {PASSAGE} · {language}</Text>
          {measurements.map((row) => (
            <div key={row.model}>
              <Text size="1" weight="bold">{row.model}</Text>
              {row.samples.map((sample) => (
                <div key={sample.mode}>
                  <Text size="1">{sample.mode}: {(sample.durationMs / 1000).toFixed(1)}s · {sample.error || sample.result?.translation}</Text>
                  {sample.result?.explanation ? <Text as="p" size="1" color="gray">{sample.result.explanation}</Text> : null}
                </div>
              ))}
            </div>
          ))}
        </Flex>
      ) : null}
    </Flex>
  );
}
