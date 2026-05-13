import type { EpisodeChatMessage, FollowUpMessage, LookupRequest, LookupResult } from "./types";

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

export type PromptOptions = {
  /** Free-form learner notes appended to every prompt. */
  customPrompt?: string;
};

export async function requestLookup(
  apiKey: string,
  request: LookupRequest,
  options: PromptOptions = {},
): Promise<LookupResult> {
  const data = await callResponsesApi(apiKey, request.model, buildLookupPrompt(request, options));
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
  messages: FollowUpMessage[] | EpisodeChatMessage[],
  question: string,
  options: PromptOptions = {},
) {
  const teacher = ((options.customPrompt ?? "").trim() || TEACHER_GUIDANCE);
  const prior = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const prompt = [
    teacher,
    "",
    `Answer the learner's follow-up question in ${request.targetLanguage} unless they explicitly ask for Dutch.`,
    "Plain text only: no Markdown, no headings, no bullet lists, no code fences.",
    "Keep the answer compact — one or two short paragraphs.",
    "",
    `Target language: ${request.targetLanguage}`,
    `Selected text: ${request.targetText}`,
    `Subtitle context: ${request.cueText}`,
    prior ? `Previous messages in this episode chat:\n${prior}` : "",
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
      max_output_tokens: 700,
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

/* ------------------------------------------------------------------ *
 *  Prompt construction                                               *
 *  Designed around how a real Dutch teacher would read the cue       *
 *  before answering — separable verbs, idioms, pronominal adverbs,   *
 *  modal chains.                                                     *
 * ------------------------------------------------------------------ */

export const TEACHER_GUIDANCE = [
  "You are an experienced Dutch language teacher helping a learner understand a real subtitle line.",
  "Critical: do NOT translate the selected text in isolation. First read the WHOLE subtitle context, then",
  "decide what the selected text actually means here. Specifically check for:",
  "- Separable verbs (scheidbare werkwoorden): the prefix may live elsewhere in the sentence",
  "  (e.g. \"Daar ga ik nu wat aan doen\" → the verb is \"ergens iets aan doen\", lemma \"aandoen / aan doen\",",
  "  not bare \"doen\"; \"Hij belt mij op\" → \"opbellen\"; \"Leg het uit\" → \"uitleggen\").",
  "- Pronominal adverbs (eraan, ermee, ervan, erover, daarop, hierin) that pair with a particle.",
  "- Fixed expressions and idioms (\"zin hebben in\", \"rekening houden met\", \"de moeite waard\", \"er is\").",
  "- Modal / auxiliary chains (\"moeten blijven groeien\", \"gaan doen\", \"laten zien\") — note the main verb.",
  "- Diminutives, weak vs. strong verb forms, and whether a word is a noun, verb, adjective or particle here.",
  "- False friends with the learner's target language when relevant.",
  "If the selected word is part of a larger construction, your translation, lemma, and explanation must",
  "describe that whole construction — never just the literal word.",
].join("\n");

function buildLookupPrompt(request: LookupRequest, options: PromptOptions) {
  const teacher = ((options.customPrompt ?? "").trim() || TEACHER_GUIDANCE);

  if (request.mode === "sentence") {
    return [
      teacher,
      "",
      "The learner has selected a full Dutch sentence and wants a natural translation plus the",
      "one or two grammar points that matter most for understanding it (not an exhaustive parse).",
      "",
      `Target language for the answer: ${request.targetLanguage}`,
      `Selected sentence: ${request.targetText}`,
      `Subtitle context (the cue around it): ${request.cueText}`,
      "",
      "Return only valid JSON, no Markdown, no code fences.",
      "Return exactly this JSON shape:",
      '{"translation":"...","lemma":"","partOfSpeech":"sentence","explanation":"..."}',
      "- translation: natural, idiomatic, not literal.",
      "- explanation: one or two short sentences explaining the grammar / idiom that matters here.",
    ].join("\n");
  }

  const modeLabel =
    request.mode === "selection"
      ? "A multi-word selection. Treat it as a phrase, not a single word."
      : "A single word click. Check whether the surrounding sentence makes this part of a larger construction.";

  return [
    teacher,
    "",
    `Lookup mode: ${modeLabel}`,
    `Target language for the answer: ${request.targetLanguage}`,
    `Selected text: ${request.targetText}`,
    `Subtitle context: ${request.cueText}`,
    "",
    "Return only valid JSON, no Markdown, no code fences.",
    "Return exactly this JSON shape:",
    '{"translation":"...","lemma":"...","partOfSpeech":"...","explanation":"..."}',
    "- translation: the meaning of the selected text *as it actually functions in this sentence*.",
    "  If it is part of a separable verb, idiom, or fixed expression, translate the WHOLE construction",
    "  and indicate which extra words belong to it (e.g. \"to do something about it — pairs with 'aan'\").",
    "- lemma: dictionary form. For separable verbs use the joined infinitive (aandoen, opbellen,",
    "  uitleggen). For idioms use the canonical expression. Use the article for nouns (de/het).",
    "- partOfSpeech: in the learner's target language. If the word here is only part of a larger",
    "  construction, say so explicitly (e.g. \"глагол (часть отделяемого aandoen)\").",
    "- explanation: one or two short sentences. Highlight what is non-obvious for a learner —",
    "  separated prefix, idiom, register, false-friend pitfall, irregular form.",
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
