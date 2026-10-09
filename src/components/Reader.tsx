import { Badge, Button, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppSettings, LookupRequest, LookupState, SubtitleCue, TranscriptDocument } from "../types";
import { CueRow, getCueDomId } from "./CueRow";
import { LookupPanel } from "./LookupPanel";

type Props = {
  transcript: TranscriptDocument;
  cues: SubtitleCue[];
  settings: AppSettings;
  lookup?: LookupState;
  resumeCueId?: string;
  chatBadge?: number;
  chatOpen?: boolean;
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
  chatOpen = false,
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
  const readerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ chapter: 0, page: 0 });
  const isBook = transcript.kind === "epub";
  const chapters = transcript.chapters ?? [];
  // Render a small section at a time so a novel does not create hundreds of thousands of word buttons.
  const pageSize = 40;
  const resumeIndex = resumeCueId ? cues.findIndex((cue) => cue.id === resumeCueId) : -1;
  const resumeChapter = resumeIndex >= 0 ? chapters.findIndex((chapter) => resumeIndex >= chapter.startIndex && resumeIndex < chapter.endIndex) : -1;
  const chapterIndex = resumeChapter >= 0 ? resumeChapter : position.chapter;
  const chapter = chapters[chapterIndex];
  const pageIndex = resumeChapter >= 0 ? Math.floor((resumeIndex - chapters[resumeChapter].startIndex) / pageSize) : position.page;
  const pageCount = chapter ? Math.ceil((chapter.endIndex - chapter.startIndex) / pageSize) : 1;
  const pageStart = chapter ? chapter.startIndex + pageIndex * pageSize : 0;
  const visibleCues = isBook && chapter ? cues.slice(pageStart, Math.min(pageStart + pageSize, chapter.endIndex)) : cues;

  function navigate(chapter: number, page = 0) {
    onCloseLookup();
    onResumeComplete();
    setPosition({ chapter, page });
    readerRef.current?.scrollIntoView({ block: "start" });
  }

  function turnPage(direction: -1 | 1) {
    if (direction === 1 && pageIndex + 1 >= pageCount) navigate(chapterIndex + 1);
    else if (direction === -1 && pageIndex === 0) {
      const previous = chapters[chapterIndex - 1];
      navigate(chapterIndex - 1, Math.ceil((previous.endIndex - previous.startIndex) / pageSize) - 1);
    } else navigate(chapterIndex, pageIndex + direction);
  }

  useEffect(() => {
    if (!resumeCueId) return;
    const id = window.setTimeout(() => {
      const row = document.getElementById(getCueDomId(resumeCueId));
      row?.scrollIntoView({ block: "center" });
      onDebug("progress", "Restored reader position", { cueId: resumeCueId, found: Boolean(row) });
      if (isBook) setPosition({ chapter: chapterIndex, page: pageIndex });
      onResumeComplete();
    }, 80);
    return () => window.clearTimeout(id);
  }, [onDebug, onResumeComplete, resumeCueId, isBook, chapterIndex, pageIndex]);

  useEffect(() => {
    const root = transcriptRef.current;
    if (!root || resumeCueId) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-cue-id]"));
    let lastCueId = "";
    let frame = 0;
    function trackPosition() {
      frame = 0;
      const row = rows.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 150 && rect.top < window.innerHeight;
      });
      const cueId = row?.dataset.cueId;
      if (!cueId || cueId === lastCueId) return;
      lastCueId = cueId;
      onVisibleCueChange(cueId, cues.findIndex((cue) => cue.id === cueId));
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(trackPosition);
    }
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [cues, chapterIndex, pageIndex, onVisibleCueChange, resumeCueId]);

  // Close the translation panel on Escape without moving focus or scrolling.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && lookup && !chatOpen) onCloseLookup();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lookup, chatOpen, onCloseLookup]);

  const title = transcript.displayTitle ?? transcript.fileName.replace(/\.[a-z]+$/i, "");

  return (
    <div className={`reader ${isBook ? "book-reader" : ""}`} ref={readerRef}>
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
              {isBook ? [transcript.author, `${chapters.length} chapters`].filter(Boolean).join(" · ") : `${cues.length} cues`}
            </Text>
          </Flex>
          <Button variant="surface" onClick={onToggleChat} aria-controls="reader-chat" aria-expanded={chatOpen}>
            <MessageSquareText size={16} />
            {isBook ? "Book chat" : "Episode chat"}
            {chatBadge && chatBadge > 0 ? (
              <Badge color="gray" variant="solid" radius="full" ml="2">
                {chatBadge}
              </Badge>
            ) : null}
          </Button>
        </Flex>
      </div>

      {isBook && chapter ? (
        <nav className="chapter-navigation" aria-label="Book navigation">
          <label htmlFor="book-chapter">Chapter</label>
          <select id="book-chapter" value={chapterIndex} onChange={(event) => navigate(Number(event.target.value))}>
            {chapters.map((item, index) => <option key={item.id} value={index}>{item.title}</option>)}
          </select>
          <Text size="1" color="gray">Section {pageIndex + 1} of {pageCount} · Click a word to translate</Text>
        </nav>
      ) : null}

      <div className="transcript" ref={transcriptRef}>
        {visibleCues.map((cue) => (
          <CueRow
            key={cue.id}
            cue={cue}
            isBook={isBook}
            settings={settings}
            activeLookup={lookup && lookup.request.cueId === cue.id ? lookup : undefined}
            onLookup={onLookup}
            onDebug={onDebug}
          />
        ))}
      </div>
      {isBook && chapter ? (
        <nav className="book-pagination" aria-label="Reading sections">
          <Button variant="surface" disabled={chapterIndex === 0 && pageIndex === 0} onClick={() => turnPage(-1)}>
            <ChevronLeft size={16} /> Previous
          </Button>
          <Text size="1" color="gray" align="center">Chapter {chapterIndex + 1} of {chapters.length}<br />Section {pageIndex + 1} of {pageCount}</Text>
          <Button variant="surface" disabled={chapterIndex === chapters.length - 1 && pageIndex === pageCount - 1} onClick={() => turnPage(1)}>
            Next <ChevronRight size={16} />
          </Button>
        </nav>
      ) : null}
      {lookup && !chatOpen ? (
        <LookupPanel lookup={lookup} onAsk={onAskFollowUp} onClose={onCloseLookup} onRetry={onRetryLookup} />
      ) : null}
    </div>
  );
}
