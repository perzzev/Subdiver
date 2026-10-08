import type { EpisodeChatMessage, FollowUpMessage, LearnerLevel, LookupRequest, LookupResult } from "./types";

type ResponsesApiResult = {
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type PromptOptions = {
  /** Free-form learner notes appended to every prompt. */
  customPrompt?: string;
  signal?: AbortSignal;
};

const LOOKUP_FORMAT = {
  type: "json_schema",
  name: "dutch_lookup",
  strict: true,
  schema: {
    type: "object",
    properties: {
      translation: { type: "string" },
      lemma: { type: "string" },
      partOfSpeech: { type: "string" },
      explanation: { type: "string" },
    },
    required: ["translation", "lemma", "partOfSpeech", "explanation"],
    additionalProperties: false,
  },
};

class IncompleteResponseError extends Error {}

const LEVEL_ORDER = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
const FREQUENCIES = ["common", "uncommon", "uncertain"];
const REGISTERS = ["general", "literary", "archaic", "specialist", "proper_name", "uncertain"];
const ADVICE_LEVELS = [...Object.keys(LEVEL_ORDER), "uncertain"];
const LEARNING_ADVICE_SCHEMA = {
  type: "object",
  properties: {
    frequency: { type: "string", enum: FREQUENCIES },
    register: { type: "string", enum: REGISTERS },
    level: { type: "string", enum: ADVICE_LEVELS },
    tip: { type: "string" },
  },
  required: ["frequency", "register", "level", "tip"],
  additionalProperties: false,
};

/** A clicked word or a one-word selection can receive a learning priority hint. */
export function getLearningHintLevel(request: Pick<LookupRequest, "mode" | "targetText" | "learnerLevel">): LearnerLevel | undefined {
  const singleWord = request.mode === "word" || (request.mode === "selection" && /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(request.targetText.trim()));
  return singleWord && request.learnerLevel && /^(A[12]|B[12]|C[12])$/.test(request.learnerLevel) ? request.learnerLevel : undefined;
}

export async function requestLookup(
  apiKey: string,
  request: LookupRequest,
  options: PromptOptions = {},
): Promise<LookupResult> {
  const input = buildLookupPrompt(request, options);
  const learnerLevel = getLearningHintLevel(request);
  const withLearningTip = Boolean(learnerLevel);
  const format = withLearningTip ? {
    ...LOOKUP_FORMAT,
    name: "dutch_lookup_with_learning_tip",
    schema: {
      ...LOOKUP_FORMAT.schema,
      properties: { ...LOOKUP_FORMAT.schema.properties, learningAdvice: LEARNING_ADVICE_SCHEMA },
      required: [...LOOKUP_FORMAT.schema.required, "learningAdvice"],
    },
  } : LOOKUP_FORMAT;
  try {
    const data = await callResponsesApi(apiKey, request.model, input, options.signal, format);
    return parseLookupResult(extractOutputText(data), learnerLevel);
  } catch (error) {
    // Retry only a truncated response, once. Never retry cancellations, refusals,
    // authorization or rate-limit errors, or quietly change the chosen model.
    if (!(error instanceof IncompleteResponseError) || options.signal?.aborted) throw error;
    const data = await callResponsesApi(apiKey, request.model, input, options.signal, format, 2400);
    return parseLookupResult(extractOutputText(data), learnerLevel);
  }
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
    `Passage context: ${request.cueText}`,
    prior ? `Previous messages in this reading chat:\n${prior}` : "",
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await callResponsesApi(apiKey, request.model, prompt, options.signal);
  return extractOutputText(data);
}

async function callResponsesApi(
  apiKey: string, model: string, input: string, signal?: AbortSignal,
  format?: typeof LOOKUP_FORMAT, maxOutputTokens = 700,
): Promise<ResponsesApiResult> {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: maxOutputTokens,
      store: false,
      ...(format ? { text: { format } } : {}),
      // These models support skipping reasoning. Older GPT-4 models need no
      // reasoning parameter; original GPT-5 models do not support "none".
      ...(/^gpt-5\.(?:4(?:-mini|-nano)?|5)(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? { reasoning: { effort: "none" } } : {}),
    }),
    signal: requestSignal,
  });

  const raw = await response.text();
  let data: ResponsesApiResult;
  try {
    data = JSON.parse(raw) as ResponsesApiResult;
  } catch {
    throw new Error(`OpenAI returned an unreadable response (HTTP ${response.status}). Please try again.`);
  }

  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed with HTTP ${response.status}`);
  }

  if (data.status === "incomplete") {
    if (data.incomplete_details?.reason === "max_output_tokens") {
      throw new IncompleteResponseError("The model reached its response limit. Try a lighter model or retry the lookup.");
    }
    throw new Error("The model could not complete this response. Try another passage or model.");
  }
  if (data.error || data.status === "failed") {
    throw new Error(data.error?.message || "The model could not complete this response. Please try again.");
  }
  for (const item of data.output || []) {
    if (item.content?.some((content) => content.type === "refusal")) {
      throw new Error("The model declined this request. Try another passage.");
    }
  }

  return data;
}

/* ------------------------------------------------------------------ *
 *  Prompt construction                                               *
 *  Designed around how a real Dutch teacher would read the cue       *
 *  before answering — separable verbs, idioms, pronominal adverbs,   *
 *  modal chains.                                                     *
 * ------------------------------------------------------------------ */

// Retained for recognizing and upgrading the default saved by older versions.
export const PREVIOUS_TEACHER_GUIDANCE = [
  "You are an experienced Dutch language teacher helping a learner understand a Dutch passage from a subtitle or book.",
  "Critical: do NOT translate the selected text in isolation. First read the WHOLE passage context, then",
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

export const WORD_PARTS_GUIDANCE = [
  "When the learner clicks a single word, check whether it is a compound or has recognizable roots, prefixes, or suffixes that help explain and remember its meaning.",
  "If useful, include a compact breakdown in explanation: Dutch part = meaning in the learner's target language, joined with +. You may also add short English glosses when helpful.",
  "Briefly connect the parts to the word's meaning in this passage and give a memorable association (e.g. straat + lamp = street + lamp → streetlight; translate the glosses into the target language).",
  "Use the dictionary form for an inflected word where appropriate; distinguish grammatical endings and linking elements from meaningful roots.",
  "Only use linguistically justified parts. Do not split words merely because letters happen to match, invent etymology, or assume the contextual meaning is always the literal sum of the parts. Skip the breakdown when it is unclear or unhelpful.",
  "Explain modern word formation; only claim a historical origin if you are certain. Keep the breakdown brief and inside explanation, preserving the contextual translation and the required output format.",
].join("\n");

export const TEACHER_GUIDANCE = `${PREVIOUS_TEACHER_GUIDANCE}\n${WORD_PARTS_GUIDANCE}`;

function buildLookupPrompt(request: LookupRequest, options: PromptOptions) {
  const teacher = ((options.customPrompt ?? "").trim() || TEACHER_GUIDANCE);
  const level = getLearningHintLevel(request);
  const learningInstructions = level ? [
    "Assess the selected word, in its contextual meaning or construction, independently of any learner level. The application will compare your assessment with the learner's saved level; do not assume a learner level yourself.",
    "First classify learningAdvice.register independently of the learner's level: general, literary, archaic, specialist, proper_name or uncertain. Everyday vocabulary such as boodschappen and werken is general; gijlieden is archaic; gluconeogenese is specialist. A word appearing in this passage does not make it generally useful.",
    "Then classify learningAdvice.frequency as common, uncommon or uncertain in CURRENT general Dutch, not just within a profession or in old literature. Use learningAdvice.level to estimate the earliest CEFR level where the contextual meaning is useful: A1, A2, B1, B2, C1, C2, or uncertain.",
    "Estimate the word's level independently of the learner. Do not lower its level to make a recommendation: a common word can still be too advanced for a beginner. A1 covers basic concrete everyday vocabulary; A2 routine everyday needs; B1 everyday narratives and common connections between ideas; B2 more abstract topics and general news; C1 advanced nuanced language; C2 highly nuanced language. If you cannot confidently estimate it, use uncertain.",
    "Supply a learning tip ONLY when frequency is common AND register is general AND the estimated level is known. Rare, literary, archaic and specialist words are NEVER eligible. When uncertain about any criterion, use uncertain and an empty tip.",
    "Do not recommend a rare technical meaning merely because another meaning of the spelling is common. Classify the actual contextual meaning.",
    `- learningAdvice.tip: ONLY after those three checks pass, write one short encouraging sentence (at most 25 words) in ${request.targetLanguage}, explaining why this is common, useful vocabulary worth learning. Do not mention a learner level; the application adds it. Otherwise return an empty string; give no negative or 'not worth learning' note.`,
    "CEFR is a learning-priority estimate here, not an official classification of this word. Do not invent frequency statistics or claim an official CEFR word list.",
  ] : [];
  const shape = (sentence = false) => JSON.stringify({ translation: "...", lemma: sentence ? "" : "...", partOfSpeech: sentence ? "sentence" : "...", explanation: "...", ...(level ? { learningAdvice: { frequency: "...", register: "...", level: "...", tip: "... or empty string" } } : {}) });

  if (request.mode === "sentence" || request.mode === "selection") {
    const selection = request.mode === "selection";
    return [
      teacher,
      "",
      selection
        ? "The learner has selected Dutch text: it may be a word, a phrase, several sentences, or several paragraphs."
        : "The learner has selected a full Dutch sentence.",
      "The learner wants a complete natural translation plus one or two grammar points that matter most for understanding it (not an exhaustive parse).",
      ...(selection ? [
        "Translate ALL selected text, from the first selected word through the last, in its original order.",
        "Include every selected sentence and paragraph; do not summarize, omit later sentences, or focus only on the first word, phrase or sentence.",
        "Use the surrounding passages for context, but translate only the selection. For a phrase that is part of a larger construction, explain that construction briefly without losing any selected text.",
      ] : []),
      "",
      `Target language for the answer: ${request.targetLanguage}`,
      `Write translation and explanation in ${request.targetLanguage}. Dutch quotations and brief English word glosses are allowed; do not write whole explanations in Dutch or English unless that is the target language.`,
      `${selection ? "Selected text" : "Selected sentence"}: ${request.targetText}`,
      `Surrounding passage: ${request.cueText}`,
      "",
      "Return only valid JSON, no Markdown, no code fences.",
      "Return exactly this JSON shape:",
      shape(!selection),
      "- translation: the complete natural, idiomatic translation, not literal. Preserve the sentence boundaries.",
      ...(selection ? ["- lemma and partOfSpeech: for a word or short phrase, give its dictionary form and classification when useful. For multiple sentences, leave lemma empty and classify it as selected text in the target language."] : []),
      "- explanation: one or two short sentences explaining the grammar / idiom that matters here.",
      ...learningInstructions,
    ].join("\n");
  }

  return [
    teacher,
    // Personal teacher instructions replace the default, but a clicked word
    // should still receive the requested memory aid when it is appropriate.
    ...(request.mode === "word" && !teacher.includes(WORD_PARTS_GUIDANCE) ? [WORD_PARTS_GUIDANCE] : []),
    "",
    "Lookup mode: A single word click. Check whether the surrounding sentence makes this part of a larger construction.",
    `Target language for the answer: ${request.targetLanguage}`,
    `Write translation and explanation in ${request.targetLanguage}. Dutch quotations and brief English word glosses are allowed; do not write whole explanations in Dutch or English unless that is the target language.`,
    `Selected text: ${request.targetText}`,
    `Passage context: ${request.cueText}`,
    "",
    "Return only valid JSON, no Markdown, no code fences.",
    "Return exactly this JSON shape:",
    shape(),
    "- translation: the meaning of the selected text *as it actually functions in this sentence*.",
    "  If it is part of a separable verb, idiom, or fixed expression, translate the WHOLE construction",
    "  and indicate which extra words belong to it (e.g. \"to do something about it — pairs with 'aan'\").",
    "- lemma: dictionary form. For separable verbs use the joined infinitive (aandoen, opbellen,",
    "  uitleggen). For idioms use the canonical expression. Use the article for nouns (de/het).",
    "- partOfSpeech: in the learner's target language. If the word here is only part of a larger",
    "  construction, say so explicitly (e.g. \"глагол (часть отделяемого aandoen)\").",
    "- explanation: one or two short sentences, including a brief word-parts breakdown for a clicked word when useful. Highlight what is non-obvious for a learner —",
    "  separated prefix, idiom, register, false-friend pitfall, irregular form.",
    ...learningInstructions,
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

function parseLookupResult(text: string, learnerLevel?: LearnerLevel): LookupResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  if (!cleaned) {
    throw new Error("The model returned an empty response. Nothing was cached; try again or choose another model.");
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      typeof parsed.translation !== "string" || !parsed.translation.trim() ||
      typeof parsed.lemma !== "string" || typeof parsed.partOfSpeech !== "string" ||
      typeof parsed.explanation !== "string") throw new Error("Invalid lookup fields");
    let learningTip: string | undefined;
    if (learnerLevel) {
      const advice = parsed.learningAdvice as Record<string, unknown> | undefined;
      if (!advice || typeof advice !== "object" || Array.isArray(advice) ||
        typeof advice.frequency !== "string" || !FREQUENCIES.includes(advice.frequency) ||
        typeof advice.register !== "string" || !REGISTERS.includes(advice.register) ||
        typeof advice.level !== "string" || !ADVICE_LEVELS.includes(advice.level) ||
        typeof advice.tip !== "string") throw new Error("Invalid learning advice");
      // Enforce the eligibility rules even if the model supplies an enthusiastic
      // tip for a word it has classified as rare, literary or above this level.
      if (advice.frequency === "common" && advice.register === "general" && advice.level !== "uncertain" &&
        LEVEL_ORDER[advice.level as LearnerLevel] <= LEVEL_ORDER[learnerLevel]) {
        learningTip = advice.tip.trim() || undefined;
      }
    }
    return {
      translation: parsed.translation.trim(),
      lemma: parsed.lemma || undefined,
      partOfSpeech: parsed.partOfSpeech || undefined,
      explanation: parsed.explanation,
      ...(learningTip ? { learningTip } : {}),
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
