import { Badge, Button, Callout, Flex, IconButton, Spinner, Text } from "@radix-ui/themes";
import { Info, MessageSquareText, X } from "lucide-react";
import type { LookupRequest, LookupState } from "../types";

export function InlineLookup({
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
  return (
    <div className="inline-lookup" role="dialog" aria-label="Translation">
      <Flex justify="between" align="center" gap="3" className="inline-lookup-head">
        <Flex align="center" gap="2">
          <Badge variant="soft">
            {lookup.request.mode === "sentence"
              ? "sentence"
              : lookup.request.mode === "selection"
                ? "selection"
                : "word"}
          </Badge>
          <Text size="2" weight="bold" className="inline-lookup-target">
            {lookup.request.targetText}
          </Text>
          {lookup.fromCache ? (
            <Badge color="gray" variant="surface">
              cached
            </Badge>
          ) : null}
        </Flex>
        <IconButton variant="ghost" size="1" onClick={onClose} aria-label="Close translation">
          <X size={14} />
        </IconButton>
      </Flex>

      {lookup.loading ? (
        <Flex align="center" gap="2" className="inline-lookup-body">
          <Spinner />
          <Text size="2" color="gray">
            Translating in context...
          </Text>
        </Flex>
      ) : lookup.error ? (
        <div className="inline-lookup-body">
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
        <div className="inline-lookup-body">
          <Text as="p" size="4" className="inline-lookup-translation">
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
          <Flex gap="2" mt="3">
            <Button variant="soft" onClick={onAsk}>
              <MessageSquareText size={15} />
              Ask follow-up
            </Button>
          </Flex>
        </div>
      ) : null}
    </div>
  );
}
