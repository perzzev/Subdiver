export type SubtitleCue = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  rawText: string;
};

export type AppSettings = {
  apiKey: string;
  targetLanguage: string;
  model: string;
  persistApiKey: boolean;
  /**
   * Extra teacher instructions appended to every lookup and follow-up prompt.
   * Lets the learner shape how the model explains things — e.g. "Always show
   * the noun with its article", "Mention false friends with Russian", etc.
   */
  customPrompt: string;
};

export type LookupMode = "word" | "selection" | "sentence";

export type LookupRequest = {
  targetText: string;
  cueText: string;
  cueId: string;
  cueStartMs: number;
  cueEndMs: number;
  targetLanguage: string;
  model: string;
  mode: LookupMode;
};

export type LookupResult = {
  translation: string;
  lemma?: string;
  partOfSpeech?: string;
  explanation: string;
};

export type LookupState = {
  request: LookupRequest;
  result?: LookupResult;
  error?: string;
  loading: boolean;
  fromCache: boolean;
};

export type FollowUpMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type EpisodeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Snapshot of what was selected when this turn started. */
  contextSelection?: string;
  /** Cue id the selection belonged to — lets us scroll back to it. */
  contextCueId?: string;
  /** Cue text snapshot for the assistant turn. */
  contextCueText?: string;
};

export type EpisodeChat = {
  transcriptKey: string;
  messages: EpisodeChatMessage[];
  updatedAt: number;
};

export type TranscriptSource =
  | {
      type: "sample";
      sampleSlug: string;
    }
  | {
      type: "upload";
    };

export type TranscriptDocument = {
  fileName: string;
  loadedAt: number;
  cues: SubtitleCue[];
  rawText: string;
  source?: TranscriptSource;
  /** Friendly title for the catalog. */
  displayTitle?: string;
};

export type ReaderProgress = {
  transcriptKey: string;
  cueId: string;
  updatedAt: number;
  /** Total cue count of the transcript, captured at save time. */
  totalCues?: number;
  /** Convenience: zero-based index of the cue inside the transcript. */
  cueIndex?: number;
};

export type ThemeId = "reader" | "cinema" | "warm";
