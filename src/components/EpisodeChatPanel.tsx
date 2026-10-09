import { Box, Button, Flex, Heading, IconButton, ScrollArea, Separator, Spinner, Text, TextArea } from "@radix-ui/themes";
import { CornerUpLeft, PanelRightClose, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatConversation } from "../types";

type Props = {
  contentLabel?: "book" | "episode";
  open: boolean;
  conversations: ChatConversation[];
  activeConversationId?: string;
  loading: boolean;
  onSubmit: (question: string) => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
  onClear: () => void;
  onJumpToCue: (cueId: string) => void;
};

export function EpisodeChatPanel({
  contentLabel = "episode",
  open,
  conversations,
  activeConversationId,
  loading,
  onSubmit,
  onSelectConversation,
  onDeleteConversation,
  onClose,
  onClear,
  onJumpToCue,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = activeConversationId ? drafts[activeConversationId] ?? "" : "";
  function setDraft(value: string) {
    if (activeConversationId) setDrafts(previous => ({ ...previous, [activeConversationId]: value }));
  }
  const panelRef = useRef<HTMLElement>(null);
  const focusOriginRef = useRef<HTMLElement | null>(null);
  const threadsRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId),
    [conversations, activeConversationId],
  );
  const messages = activeConversation?.messages ?? [];
  const hasHistory = conversations.some((c) => c.messages.length > 0);

  const closePanel = useCallback(() => {
    const restoreFocus = panelRef.current?.contains(document.activeElement);
    onClose();
    if (restoreFocus) requestAnimationFrame(() => {
      const origin = focusOriginRef.current;
      const target = origin?.isConnected ? origin : document.querySelector<HTMLElement>('[aria-controls="reader-chat"]');
      target?.focus({ preventScroll: true });
    });
  }, [onClose]);

  // Focus on opening; keep keyboard focus on the tabs when switching threads.
  useEffect(() => {
    if (!open) return;
    // Ask follow-up unmounts its button before this effect runs.
    focusOriginRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
    const id = window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    }, 200);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closePanel();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, closePanel]);

  useEffect(() => {
    if (!open) return;
    const strip = threadsRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !active) return;
    // Scroll only the strip, so switching threads never moves the book.
    const item = active.getBoundingClientRect();
    const bounds = strip.getBoundingClientRect();
    if (item.left < bounds.left) strip.scrollLeft -= bounds.left - item.left + 12;
    else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right + 12;
  }, [open, activeConversationId, conversations.length]);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, loading, activeConversationId]);

  function submit() {
    const question = draft.trim();
    if (!question || loading) return;
    setDraft("");
    onSubmit(question);
  }

  return (
    <aside id="reader-chat" ref={panelRef} className={`side-panel ${open ? "open" : ""}`} aria-label={contentLabel === "book" ? "Book chat" : "Episode chat"} aria-hidden={!open} inert={!open}>
      <Flex align="center" justify="between" p="4">
        <Heading as="h2" size="4">
          {contentLabel === "book" ? "Book chat" : "Episode chat"}
        </Heading>
        <Flex gap="2">
          <IconButton
            variant="ghost"
            color="gray"
            onClick={onClear}
            aria-label={`Clear all threads for this ${contentLabel}`}
            title={`Clear all threads for this ${contentLabel}`}
            disabled={!hasHistory}
          >
            <Trash2 size={16} />
          </IconButton>
          <IconButton variant="ghost" onClick={closePanel} aria-label="Close chat panel">
            <PanelRightClose size={18} />
          </IconButton>
        </Flex>
      </Flex>
      <Separator />

      <div className="chat-subhead">
        {conversations.length > 0 ? (
          <div className="thread-strip" ref={threadsRef} role="tablist" aria-label="Question threads">
            {conversations.map((conversation) => {
              const label = conversation.contextSelection?.trim() || "New question";
              const isActive = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={`thread-chip ${isActive ? "active" : ""}`}
                  title={label}
                  onClick={() => onSelectConversation(conversation.id)}
                  onKeyDown={event => {
                    const index = conversations.findIndex(item => item.id === conversation.id);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? conversations.length - 1
                      : event.key === "ArrowRight" ? (index + 1) % conversations.length
                      : event.key === "ArrowLeft" ? (index - 1 + conversations.length) % conversations.length : undefined;
                    if (next === undefined) return;
                    event.preventDefault();
                    onSelectConversation(conversations[next].id);
                    threadsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
                  }}
                >
                  <span className="thread-chip-label">{label}</span>
                  {conversation.messages.length > 0 ? (
                    <span className="thread-chip-count">{conversation.messages.length}</span>
                  ) : (
                    <span className="thread-chip-count thread-chip-new">new</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        {activeConversation ? (
          <Box p="4" className="context-card">
            <Flex justify="between" align="start" gap="2">
              <Box style={{ minWidth: 0 }}>
                <Text as="div" size="1" color="gray" className="context-label">
                  About
                </Text>
                <button
                  type="button"
                  className="context-subject"
                  onClick={() =>
                    activeConversation.contextCueId && onJumpToCue(activeConversation.contextCueId)
                  }
                  title={activeConversation.contextCueId ? "Jump back to that passage" : undefined}
                  disabled={!activeConversation.contextCueId}
                >
                  <span>{activeConversation.contextSelection?.trim() || "General question"}</span>
                  {activeConversation.contextCueId ? <CornerUpLeft size={13} /> : null}
                </button>
                {activeConversation.contextCueText ? (
                  <Text as="p" size="1" color="gray" className="context-cue">
                    {activeConversation.contextCueText}
                  </Text>
                ) : null}
              </Box>
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                aria-label="Delete this thread"
                title="Delete this thread"
                onClick={() => onDeleteConversation(activeConversation.id)}
              >
                <Trash2 size={14} />
              </IconButton>
            </Flex>
          </Box>
        ) : null}
      </div>

      <ScrollArea className="message-scroll" ref={scrollRef}>
        <Flex direction="column" gap="3" p="4">
          {!activeConversation ? (
            <Text size="2" color="gray">
              Click a word or sentence in the passage, then hit <strong>Ask follow-up</strong> to
              start a thread here. Each word you ask about gets its own thread — switch between them
              above, and the newest opens on top.
            </Text>
          ) : messages.length === 0 ? (
            <Text size="2" color="gray">
              Ask about grammar, usage, word choice, or a more literal translation. This thread is
              saved for this {contentLabel} — come back later to review what you wondered about.
            </Text>
          ) : null}
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              <Text size="2">{message.content}</Text>
            </div>
          ))}
          {loading ? (
            <Flex align="center" gap="2">
              <Spinner />
              <Text size="2" color="gray">
                Thinking...
              </Text>
            </Flex>
          ) : null}
        </Flex>
      </ScrollArea>

      <Box p="4" className="follow-up-composer" ref={composerRef}>
        <div className="follow-up-input-row">
          <TextArea
            className="follow-up-textarea"
            value={draft}
            placeholder={
              activeConversation
                ? "Ask a question. Enter to send, Shift+Enter for a new line."
                : "Translate a word first, then ask about it here."
            }
            disabled={!activeConversation}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button
            className="follow-up-send"
            disabled={loading || !activeConversation || draft.trim().length === 0}
            onClick={submit}
          >
            Send
          </Button>
        </div>
      </Box>
    </aside>
  );
}
