import { Box, Button, Flex, Heading, IconButton, ScrollArea, Separator, Spinner, Text, TextArea } from "@radix-ui/themes";
import { CornerUpLeft, PanelRightClose, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatConversation } from "../types";

type Props = {
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
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId),
    [conversations, activeConversationId],
  );
  const messages = activeConversation?.messages ?? [];
  const hasHistory = conversations.some((c) => c.messages.length > 0);

  // Focus the composer when the panel opens or the learner switches threads.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }, 200);
    return () => window.clearTimeout(id);
  }, [open, activeConversationId]);

  // Switching threads should not carry a half-typed question across.
  useEffect(() => {
    setDraft("");
  }, [activeConversationId]);

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
    <aside className={`side-panel ${open ? "open" : ""}`} aria-hidden={!open}>
      <Flex align="center" justify="between" p="4">
        <Heading as="h2" size="4">
          Episode chat
        </Heading>
        <Flex gap="2">
          <IconButton
            variant="ghost"
            color="gray"
            onClick={onClear}
            aria-label="Clear all threads for this episode"
            title="Clear all threads for this episode"
            disabled={!hasHistory}
          >
            <Trash2 size={16} />
          </IconButton>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close chat panel">
            <PanelRightClose size={18} />
          </IconButton>
        </Flex>
      </Flex>
      <Separator />

      <div className="chat-subhead">
        {conversations.length > 0 ? (
          <div className="thread-strip" role="tablist" aria-label="Question threads">
            {conversations.map((conversation) => {
              const label = conversation.contextSelection?.trim() || "New question";
              const isActive = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`thread-chip ${isActive ? "active" : ""}`}
                  title={label}
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  {label}
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
                <Text size="1" color="gray">
                  About
                </Text>
                <button
                  type="button"
                  className="context-subject"
                  onClick={() =>
                    activeConversation.contextCueId && onJumpToCue(activeConversation.contextCueId)
                  }
                  title={activeConversation.contextCueId ? "Jump back to that cue" : undefined}
                  disabled={!activeConversation.contextCueId}
                >
                  {activeConversation.contextSelection?.trim() || "General question"}
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
              Click a word or sentence in the transcript, then hit <strong>Ask follow-up</strong> to
              start a thread here. Each word you ask about gets its own thread — switch between them
              above, and the newest opens on top.
            </Text>
          ) : messages.length === 0 ? (
            <Text size="2" color="gray">
              Ask about grammar, usage, word choice, or a more literal translation. This thread is
              saved for the episode — come back later to review what you wondered about.
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
