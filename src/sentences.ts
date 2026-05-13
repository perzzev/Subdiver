import { tokenizeCueText } from "./subtitles";

export type CueToken =
  | { kind: "word"; text: string; sentenceIndex: number }
  | { kind: "text"; text: string; sentenceIndex: number };

export type SentenceRange = {
  /** Zero-based sentence index inside the cue. */
  index: number;
  /** Concatenated cleaned text of the sentence (single line, trimmed). */
  text: string;
};

/**
 * Tokenize cue text and attach a sentence index to every token. Sentences are
 * split on `.`, `?`, `!` and `…` (and Dutch ellipsis). Common abbreviations
 * are kept inside the current sentence.
 *
 * The returned tokens are 1:1 aligned with `tokenizeCueText(cue.text)` plus
 * the `sentenceIndex`. UI rendering can group tokens by `sentenceIndex` to
 * highlight a whole sentence on hover.
 */
export function tokenizeCueWithSentences(text: string): {
  tokens: CueToken[];
  sentences: SentenceRange[];
} {
  const baseTokens = tokenizeCueText(text);
  const abbreviations = new Set([
    "mevr",
    "dhr",
    "mr",
    "drs",
    "dr",
    "nr",
    "bv",
    "blz",
    "etc",
    "enz",
    "fig",
    "ca",
    "tel",
    "art",
  ]);

  const tokens: CueToken[] = [];
  const sentences: SentenceRange[] = [];
  let currentIndex = 0;
  let currentBuf: string[] = [];

  function flushSentence() {
    const raw = currentBuf.join("").replace(/\s+/g, " ").trim();
    if (raw) {
      sentences.push({ index: currentIndex, text: raw });
      currentIndex += 1;
    }
    currentBuf = [];
  }

  for (let i = 0; i < baseTokens.length; i += 1) {
    const token = baseTokens[i];
    tokens.push({ ...token, sentenceIndex: currentIndex });
    currentBuf.push(token.text);

    if (token.kind === "text") {
      // Look for a terminal punctuation in this text chunk.
      const match = /[.?!…]+/.exec(token.text);
      if (!match) continue;

      // Decide if the previous word was an abbreviation.
      const prevWord = findPrevWord(baseTokens, i);
      const isAbbrev = prevWord && abbreviations.has(prevWord.toLowerCase());
      if (isAbbrev) continue;

      // If there is more meaningful content after this token, flush sentence.
      const hasMore = baseTokens.slice(i + 1).some((t) => t.kind === "word");
      if (hasMore) flushSentence();
    }
  }

  // Flush trailing buffer regardless of terminal punctuation.
  flushSentence();
  if (sentences.length === 0) {
    // Single-sentence cue: every token already has sentenceIndex 0.
    sentences.push({ index: 0, text: text.replace(/\s+/g, " ").trim() });
  }
  return { tokens, sentences };
}

function findPrevWord(tokens: Array<{ kind: "word" | "text"; text: string }>, fromIndex: number) {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (tokens[i].kind === "word") return tokens[i].text;
  }
  return undefined;
}
