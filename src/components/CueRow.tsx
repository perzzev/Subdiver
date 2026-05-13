import { memo, useMemo, useRef } from "react";
import type { AppSettings, LookupRequest, LookupState, SubtitleCue } from "../types";
import { formatTimestamp } from "../subtitles";
import { tokenizeCueWithSentences } from "../sentences";
import { getCleanSelectionText } from "../utils/selection";
import { InlineLookup } from "./InlineLookup";

export function getCueDomId(cueId: string) {
  return `cue-row-${cueId}`;
}

type Props = {
  cue: SubtitleCue;
  settings: AppSettings;
  activeLookup?: LookupState;
  onLookup: (request: LookupRequest) => void;
  onCloseLookup: () => void;
  onRetryLookup: (request: LookupRequest) => void;
  onAskFollowUp: () => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
};

export const CueRow = memo(function CueRow({
  cue,
  settings,
  activeLookup,
  onLookup,
  onCloseLookup,
  onRetryLookup,
  onAskFollowUp,
  onDebug,
}: Props) {
  const { tokens, sentences } = useMemo(() => tokenizeCueWithSentences(cue.text), [cue.text]);
  const textRef = useRef<HTMLDivElement>(null);

  function buildRequest(
    targetText: string,
    mode: "word" | "selection" | "sentence",
  ): LookupRequest {
    return {
      targetText,
      cueText: cue.text,
      cueId: cue.id,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
      targetLanguage: settings.targetLanguage,
      model: settings.model,
      mode,
    };
  }

  function handleSelection() {
    window.setTimeout(() => {
      const selected = getCleanSelectionText(".cue-text", ".cue-time, .cue-sentence-marker");
      if (!selected || selected.length < 2) return;
      onDebug("selection", "Mouse/touch selection accepted", { selected, cueIndex: cue.index });
      onLookup(buildRequest(selected, "selection"));
    }, 0);
  }

  /** Group tokens by sentence index for `<span class="cue-sentence">` wrappers. */
  const grouped = useMemo(() => groupTokensBySentence(tokens), [tokens]);

  function handleWordClick(word: string, sentenceIndex: number, event: React.MouseEvent | React.KeyboardEvent) {
    // If user has live text selection, defer to selection handler.
    const liveSel = window.getSelection()?.toString().trim();
    if (liveSel && liveSel.length > 1) return;

    // Alt key → translate full sentence instead of just the word.
    const altKey =
      "altKey" in event && (event as React.MouseEvent | React.KeyboardEvent).altKey;
    if (altKey) {
      const sentence = sentences[sentenceIndex]?.text ?? cue.text;
      onLookup(buildRequest(sentence, "sentence"));
      return;
    }

    onLookup(buildRequest(word, "word"));
  }

  function handleSentenceMarker(sentenceIndex: number) {
    const sentence = sentences[sentenceIndex]?.text ?? cue.text;
    onLookup(buildRequest(sentence, "sentence"));
  }

  return (
    <div className="cue-row" id={getCueDomId(cue.id)} data-cue-id={cue.id}>
      <span className="cue-time" aria-hidden="true">
        {formatTimestamp(cue.startMs)}
      </span>

      <div
        className="cue-text"
        ref={textRef}
        onMouseUp={handleSelection}
        onTouchEnd={handleSelection}
      >
        {grouped.map((group) => (
          <span
            key={group.sentenceIndex}
            className="cue-sentence"
            data-sentence-index={group.sentenceIndex}
          >
            <button
              type="button"
              className="cue-sentence-marker"
              aria-label="Translate this sentence"
              title="Translate this sentence"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                handleSentenceMarker(group.sentenceIndex);
              }}
            >
              ¶
            </button>
            {group.tokens.map((token, index) =>
              token.kind === "word" ? (
                <span
                  className="word-token"
                  key={`${group.sentenceIndex}-${index}`}
                  role="button"
                  tabIndex={0}
                  title="Click to translate · Alt+click for the sentence"
                  onClick={(event) => handleWordClick(token.text, group.sentenceIndex, event)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    handleWordClick(token.text, group.sentenceIndex, event);
                  }}
                >
                  {token.text}
                </span>
              ) : (
                <span key={`${group.sentenceIndex}-${index}-t`}>{token.text}</span>
              ),
            )}
          </span>
        ))}
      </div>

      {activeLookup ? (
        <InlineLookup
          lookup={activeLookup}
          onAsk={onAskFollowUp}
          onClose={onCloseLookup}
          onRetry={onRetryLookup}
        />
      ) : null}
    </div>
  );
});

type Group = {
  sentenceIndex: number;
  tokens: Array<{ kind: "word" | "text"; text: string }>;
};

function groupTokensBySentence(
  tokens: Array<{ kind: "word" | "text"; text: string; sentenceIndex: number }>,
): Group[] {
  const groups: Group[] = [];
  for (const token of tokens) {
    const last = groups[groups.length - 1];
    if (!last || last.sentenceIndex !== token.sentenceIndex) {
      groups.push({ sentenceIndex: token.sentenceIndex, tokens: [{ kind: token.kind, text: token.text }] });
    } else {
      last.tokens.push({ kind: token.kind, text: token.text });
    }
  }
  return groups;
}
