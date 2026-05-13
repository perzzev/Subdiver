import { Box, Button, Flex, Heading, IconButton, ScrollArea, Separator, Spinner, Text, TextArea } from "@radix-ui/themes";
import { PanelRightClose, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EpisodeChatMessage, LookupState } from "../types";

type Props = {
  open: boolean;
  messages: EpisodeChatMessage[];
  loading: boolean;
  pendingContext?: LookupState;
  onSubmit: (question: string) => void;
  onClose: () => void;
  onClear: () => void;
  onJumpToCue: (cueId: string) => void;
};

export function EpisodeChatPanel({
  open,
  messages,
  loading,
  pendingContext,
  onSubmit,
  onClose,
  onClear,
  onJumpToCue,
}: Props) {
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }, 200);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, loading]);

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
            aria-label="Clear this episode chat"
            title="Clear this episode chat"
            disabled={messages.length === 0}
          >
            <Trash2 size={16} />
          </IconButton>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close chat panel">
            <PanelRightClose size={18} />
          </IconButton>
        </Flex>
      </Flex>
      <Separator />

      {pendingContext?.request ? (
        <Box p="4" className="context-card">
          <Text size="1" color="gray">
            About
          </Text>
          <Text as="p" weight="bold">
            {pendingContext.request.targetText}
          </Text>
          <Text size="1" color="gray">
            In
          </Text>
          <Text as="p" size="2">
            {pendingContext.request.cueText}
          </Text>
        </Box>
      ) : null}

      <ScrollArea className="message-scroll" ref={scrollRef}>
        <Flex direction="column" gap="3" p="4">
          {messages.length === 0 ? (
            <Text size="2" color="gray">
              Ask about grammar, usage, word choice, or a more literal translation. Every question is
              saved for this episode — come back later to review what you wondered about.
            </Text>
          ) : null}
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              {message.role === "user" && message.contextSelection ? (
                <button
                  type="button"
                  className="message-context"
                  onClick={() => message.contextCueId && onJumpToCue(message.contextCueId)}
                  title={message.contextCueId ? "Jump back to that cue" : undefined}
                >
                  About: <strong>{message.contextSelection}</strong>
                  {message.contextCueText ? <span className="message-context-cue"> · {message.contextCueText}</span> : null}
                </button>
              ) : null}
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
              pendingContext?.request
                ? "Ask a question. Enter to send, Shift+Enter for a new line."
                : "Translate a word first, then ask about it here."
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button className="follow-up-send" disabled={loading || draft.trim().length === 0} onClick={submit}>
            Send
          </Button>
        </div>
      </Box>
    </aside>
  );
}
