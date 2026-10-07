import { memo, useEffect, useMemo, useRef } from "react";
import type { AppSettings, LookupRequest, LookupState, SubtitleCue } from "../types";
import { formatTimestamp } from "../subtitles";
import { tokenizeCueWithSentences } from "../sentences";
import { getCleanSelectionText } from "../utils/selection";

export function getCueDomId(cueId: string) {
  return `cue-row-${cueId}`;
}

type Props = {
  cue: SubtitleCue;
  isBook?: boolean;
  settings: AppSettings;
  activeLookup?: LookupState;
  onLookup: (request: LookupRequest) => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
};

export const CueRow = memo(function CueRow({
  cue,
  isBook = false,
  settings,
  activeLookup,
  onLookup,
  onDebug,
}: Props) {
  const { tokens, sentences } = useMemo(() => tokenizeCueWithSentences(cue.text), [cue.text]);
  const textRef = useRef<HTMLDivElement>(null);
  const selectionTimer = useRef<number | undefined>(undefined);
  const suppressSelectionClick = useRef(false);
  useEffect(() => () => window.clearTimeout(selectionTimer.current), []);

  function translate(targetText: string, mode: "word" | "selection" | "sentence") {
    window.clearTimeout(selectionTimer.current);
    onLookup(buildRequest(targetText, mode));
  }

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

  function handleSelection(event: React.MouseEvent | React.TouchEvent) {
    if ((event.target as HTMLElement).closest(".cue-sentence-marker") || event.altKey) return;
    const selected = getCleanSelectionText(".cue-text", ".cue-time, .cue-sentence-marker");
    if (!selected) return;
    suppressSelectionClick.current = true;
    window.clearTimeout(selectionTimer.current);
    // Capture this gesture now, not whatever selection a later click leaves.
    // Defer until click so the trailing click of a drag cannot become a word lookup.
    selectionTimer.current = window.setTimeout(() => {
      onDebug("selection", "Mouse/touch selection accepted", { selected, cueIndex: cue.index });
      translate(selected, "selection");
    }, 0);
  }

  /** Group tokens by sentence index for `<span class="cue-sentence">` wrappers. */
  const grouped = useMemo(() => groupTokensBySentence(tokens), [tokens]);

  function handleWordClick(word: string, sentenceIndex: number, event: React.MouseEvent | React.KeyboardEvent) {
    // Alt key → translate full sentence instead of just the word.
    const altKey =
      "altKey" in event && (event as React.MouseEvent | React.KeyboardEvent).altKey;
    if (altKey) {
      suppressSelectionClick.current = false;
      const sentence = sentences[sentenceIndex]?.text ?? cue.text;
      translate(sentence, "sentence");
      return;
    }

    // Some browsers deliver click after the selection timer has already cleared
    // the native range. Remember the gesture until that trailing click arrives.
    if (event.type === "click" && suppressSelectionClick.current) {
      suppressSelectionClick.current = false;
      return;
    }
    suppressSelectionClick.current = false;

    // A drag's trailing mouse click belongs to the selection handler. Keyboard
    // activation is an explicit new lookup even if browser selection remains.
    if (event.type === "click" && getCleanSelectionText(".cue-text", ".cue-time, .cue-sentence-marker")) return;

    translate(word, "word");
  }

  function handleSentenceMarker(sentenceIndex: number) {
    suppressSelectionClick.current = false;
    const sentence = sentences[sentenceIndex]?.text ?? cue.text;
    translate(sentence, "sentence");
  }

  return (
    <div className={`cue-row ${cue.headingLevel ? "book-heading" : ""}`} id={getCueDomId(cue.id)} data-cue-id={cue.id} data-active-lookup={Boolean(activeLookup)}>
      {!isBook ? <span className="cue-time" aria-hidden="true">
        {formatTimestamp(cue.startMs)}
      </span> : null}

      <div
        className="cue-text"
        role={cue.headingLevel ? "heading" : undefined}
        aria-level={cue.headingLevel}
        ref={textRef}
        onPointerDown={() => {
          suppressSelectionClick.current = false;
          window.clearTimeout(selectionTimer.current);
        }}
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
                  aria-pressed={activeLookup?.request.mode === "word" && activeLookup.request.targetText === token.text}
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
