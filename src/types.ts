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
};

export type LookupMode = "word" | "selection";

export type LookupRequest = {
  targetText: string;
  cueText: string;
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
};

export type ReaderProgress = {
  transcriptKey: string;
  cueId: string;
  updatedAt: number;
};
