import { Badge, Button, Callout, Flex, IconButton, Spinner, Text } from "@radix-ui/themes";
import { Info, MessageSquareText, X } from "lucide-react";
import type { LookupRequest, LookupState } from "../types";
import { getLearningHintLevel } from "../openai";

export function LookupPanel({
  lookup,
  onAsk,
  onClose,
  onRetry,
}: {
  lookup: LookupState;
  onAsk: () => void;
  onClose: () => void;
  onRetry: (request: LookupRequest) => void;
}) {
  const learnerLevel = getLearningHintLevel(lookup.request);
  return (
    <div className="lookup-panel" role="dialog" aria-label="Translation" aria-modal="false">
      <Flex justify="between" align="start" gap="3" className="lookup-panel-head">
        <Flex direction="column" gap="2" className="lookup-panel-subject">
          <Text size="1" color="gray" weight="medium">Translation</Text>
          <Flex align="center" gap="2" wrap="wrap">
            <Badge variant="soft">
              {lookup.request.mode === "sentence"
                ? "sentence"
                : lookup.request.mode === "selection"
                  ? "selection"
                  : "word"}
            </Badge>
            {lookup.fromCache ? (
              <Badge color="gray" variant="surface">
                cached
              </Badge>
            ) : null}
            {lookup.durationMs !== undefined ? (
              <Text size="1" color="gray" title={lookup.request.model}>
                {(lookup.durationMs / 1000).toFixed(1)}s
              </Text>
            ) : null}
          </Flex>
          <Text size="2" weight="bold" className="lookup-panel-target" title={lookup.request.targetText}>
            {lookup.request.targetText}
          </Text>
        </Flex>
        <IconButton variant="ghost" size="1" onClick={onClose} aria-label="Close translation">
          <X size={14} />
        </IconButton>
      </Flex>

      <div className="lookup-panel-content" aria-live="polite" aria-atomic="true">
        {lookup.loading ? (
          <Flex align="center" gap="2" className="lookup-panel-body" role="status">
            <Spinner />
            <Text size="2" color="gray">
              Translating in context...
            </Text>
          </Flex>
        ) : lookup.error ? (
          <div className="lookup-panel-body">
            <Callout.Root color="red">
              <Callout.Icon>
                <Info size={16} />
              </Callout.Icon>
              <Callout.Text>{lookup.error}</Callout.Text>
            </Callout.Root>
            <Button variant="soft" onClick={() => onRetry(lookup.request)} mt="2">
              Retry lookup
            </Button>
          </div>
        ) : lookup.result ? (
          <div className="lookup-panel-body">
            <Text as="p" size="4" className="lookup-panel-translation">
              {lookup.result.translation}
            </Text>
            <Flex gap="2" wrap="wrap" mt="2">
              {lookup.result.lemma ? <Badge variant="surface">lemma: {lookup.result.lemma}</Badge> : null}
              {lookup.result.partOfSpeech ? (
                <Badge variant="surface">{lookup.result.partOfSpeech}</Badge>
              ) : null}
            </Flex>
            {lookup.result.explanation ? (
              <Text size="2" color="gray" as="p" mt="2">
                {lookup.result.explanation}
              </Text>
            ) : null}
            {learnerLevel && lookup.result.learningTip ? (
              <Callout.Root color="teal" variant="soft" size="1" mt="3" className="lookup-learning-tip">
                <Callout.Icon><Info size={16} /></Callout.Icon>
                <Callout.Text><strong>Worth knowing at {learnerLevel}</strong><br />{lookup.result.learningTip}</Callout.Text>
              </Callout.Root>
            ) : null}
            <Flex gap="2" mt="3">
              <Button variant="soft" onClick={onAsk}>
                <MessageSquareText size={15} />
                Ask follow-up
              </Button>
            </Flex>
          </div>
        ) : null}
      </div>
    </div>
  );
}
