import type { FollowUpMessage, LookupRequest, LookupResult } from "./types";

type ResponsesApiResult = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export async function requestLookup(apiKey: string, request: LookupRequest): Promise<LookupResult> {
  const data = await callResponsesApi(apiKey, request.model, buildLookupPrompt(request));
  const text = extractOutputText(data);
  return parseLookupResult(text);
}

export async function listOpenAiModels(apiKey: string): Promise<string[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = (await response.json()) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message || `Could not load models with HTTP ${response.status}`);
  }

  return (data.data || [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
    .filter(isLikelyTextModel)
    .sort((a, b) => a.localeCompare(b));
}

export async function requestFollowUp(
  apiKey: string,
  request: LookupRequest,
  messages: FollowUpMessage[],
  question: string,
) {
  const prior = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const prompt = [
    "You are helping a Russian-speaking learner understand Dutch subtitles.",
    "Answer the user's follow-up question in the target language unless they ask otherwise.",
    "Return plain text only. Do not use Markdown formatting, headings, bullet lists, tables, code fences, or emphasis markers.",
    "Keep the answer compact and readable as one or two short paragraphs.",
    "",
    `Target language: ${request.targetLanguage}`,
    `Selected text: ${request.targetText}`,
    `Subtitle context: ${request.cueText}`,
    prior ? `Previous follow-up messages:\n${prior}` : "",
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await callResponsesApi(apiKey, request.model, prompt);
  return extractOutputText(data);
}

async function callResponsesApi(apiKey: string, model: string, input: string): Promise<ResponsesApiResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: 450,
    }),
  });

  const raw = await response.text();
  let data: ResponsesApiResult;
  try {
    data = JSON.parse(raw) as ResponsesApiResult;
  } catch {
    data = { output_text: raw };
  }

  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed with HTTP ${response.status}`);
  }

  return data;
}

function buildLookupPrompt(request: LookupRequest) {
  return [
    "You are a concise Dutch language tutor.",
    "Return only valid JSON. Do not wrap it in Markdown.",
    "Explain the selected Dutch subtitle text in context.",
    "",
    `Target language for the answer: ${request.targetLanguage}`,
    `Lookup mode: ${request.mode}`,
    `Selected text: ${request.targetText}`,
    `Subtitle context: ${request.cueText}`,
    "",
    "Return this exact JSON shape:",
    '{"translation":"...","lemma":"...","partOfSpeech":"...","explanation":"..."}',
    "Use empty strings for lemma or partOfSpeech if they are not useful.",
    "Keep explanation to one short sentence.",
  ].join("\n");
}

function extractOutputText(data: ResponsesApiResult) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks: string[] = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseLookupResult(text: string): LookupResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  if (!cleaned) {
    throw new Error("The model returned an empty response. Nothing was cached; try again or choose another model.");
  }

  try {
    const parsed = JSON.parse(cleaned) as Partial<LookupResult>;
    if (!parsed.translation || !String(parsed.translation).trim()) {
      throw new Error("The model response did not include a translation. Nothing was cached; try again.");
    }
    return {
      translation: String(parsed.translation),
      lemma: parsed.lemma ? String(parsed.lemma) : undefined,
      partOfSpeech: parsed.partOfSpeech ? String(parsed.partOfSpeech) : undefined,
      explanation: parsed.explanation ? String(parsed.explanation) : "",
    };
  } catch {
    throw new Error("The model returned an invalid lookup format. Nothing was cached; try again.");
  }
}

function isLikelyTextModel(modelId: string) {
  const lower = modelId.toLowerCase();
  if (lower.includes("embedding")) return false;
  if (lower.includes("audio")) return false;
  if (lower.includes("tts")) return false;
  if (lower.includes("whisper")) return false;
  if (lower.includes("image")) return false;
  if (lower.includes("dall-e")) return false;
  if (lower.includes("moderation")) return false;
  if (lower.includes("transcribe")) return false;
  if (lower.includes("realtime")) return false;
  return (
    lower.startsWith("gpt-") ||
    lower.startsWith("o") ||
    lower.startsWith("chatgpt-")
  );
}
