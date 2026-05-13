import { Badge, Button, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppSettings, LookupRequest, LookupState, SubtitleCue, TranscriptDocument } from "../types";
import { CueRow, getCueDomId } from "./CueRow";

type Props = {
  transcript: TranscriptDocument;
  cues: SubtitleCue[];
  settings: AppSettings;
  lookup?: LookupState;
  resumeCueId?: string;
  chatBadge?: number;
  onResumeComplete: () => void;
  onVisibleCueChange: (cueId: string, index: number) => void;
  onLookup: (request: LookupRequest) => void;
  onCloseLookup: () => void;
  onRetryLookup: (request: LookupRequest) => void;
  onAskFollowUp: () => void;
  onBack: () => void;
  onToggleChat: () => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
};

export function Reader({
  transcript,
  cues,
  settings,
  lookup,
  resumeCueId,
  chatBadge,
  onResumeComplete,
  onVisibleCueChange,
  onLookup,
  onCloseLookup,
  onRetryLookup,
  onAskFollowUp,
  onBack,
  onToggleChat,
  onDebug,
}: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resumeCueId) return;
    const id = window.setTimeout(() => {
      const row = document.getElementById(getCueDomId(resumeCueId));
      row?.scrollIntoView({ block: "center" });
      onDebug("progress", "Restored reader position", { cueId: resumeCueId, found: Boolean(row) });
      onResumeComplete();
    }, 80);
    return () => window.clearTimeout(id);
  }, [onDebug, onResumeComplete, resumeCueId]);

  useEffect(() => {
    const root = transcriptRef.current;
    if (!root) return;

    let lastCueId = "";
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const cueId = visible?.target.getAttribute("data-cue-id");
        if (!cueId || cueId === lastCueId) return;
        lastCueId = cueId;
        const index = cues.findIndex((cue) => cue.id === cueId);
        onVisibleCueChange(cueId, index);
      },
      { threshold: 0.55 },
    );

    root.querySelectorAll<HTMLElement>("[data-cue-id]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [cues, onVisibleCueChange]);

  // Close inline lookup on Escape.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && lookup) onCloseLookup();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lookup, onCloseLookup]);

  const title = transcript.displayTitle ?? transcript.fileName.replace(/\.[a-z]+$/i, "");

  return (
    <div className="reader">
      <div className="reader-strip">
        <Flex align="center" gap="3" wrap="wrap">
          <IconButton variant="surface" onClick={onBack} aria-label="Back to library">
            <ArrowLeft size={16} />
          </IconButton>
          <Flex direction="column" gap="0" style={{ flex: 1, minWidth: 0 }}>
            <Heading as="h2" size="4" className="reader-title">
              {title}
            </Heading>
            <Text size="1" color="gray">
              {cues.length} cues
            </Text>
          </Flex>
          <Button variant="surface" onClick={onToggleChat}>
            <MessageSquareText size={16} />
            Episode chat
            {chatBadge && chatBadge > 0 ? (
              <Badge color="gray" variant="solid" radius="full" ml="2">
                {chatBadge}
              </Badge>
            ) : null}
          </Button>
        </Flex>
      </div>

      <div className="transcript" ref={transcriptRef}>
        {cues.map((cue) => (
          <CueRow
            key={cue.id}
            cue={cue}
            settings={settings}
            activeLookup={lookup && lookup.request.cueId === cue.id ? lookup : undefined}
            onLookup={onLookup}
            onCloseLookup={onCloseLookup}
            onRetryLookup={onRetryLookup}
            onAskFollowUp={onAskFollowUp}
            onDebug={onDebug}
          />
        ))}
      </div>
    </div>
  );
}
