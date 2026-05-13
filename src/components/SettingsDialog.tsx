import {
  Button,
  Callout,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  Separator,
  Spinner,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { ExternalLink, Info, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { listOpenAiModels } from "../openai";
import { defaultSettings } from "../settings";
import type { AppSettings } from "../types";

const CUSTOM_PROMPT_PLACEHOLDER = [
  "Examples:",
  "- Always show nouns with the article (de / het).",
  "- Flag false friends with my native language.",
  "- For separable verbs, always show the infinitive joined and an example sentence.",
  "- Keep grammar terms in Russian.",
].join("\n");

export function SettingsDialog({
  settings,
  onChange,
  onClearCache,
  onDebug,
  open,
  onOpenChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClearCache: () => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");

  async function refreshModels() {
    setModelsError("");
    if (!settings.apiKey.trim()) {
      onDebug("models", "Model list blocked: missing API key");
      setModelsError("Enter your OpenAI API key first.");
      return;
    }

    setModelsLoading(true);
    try {
      const nextModels = await listOpenAiModels(settings.apiKey);
      setModels(nextModels);
      if (nextModels.length === 0) setModelsError("No compatible text models were returned.");
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setModelsLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger>
        <IconButton variant="surface" aria-label="Settings">
          <SettingsIcon size={17} />
        </IconButton>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Settings</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          These settings stay in this browser for the local app.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <label className="field-label">
            OpenAI API key
            <TextField.Root
              type="password"
              value={settings.apiKey}
              placeholder="sk-..."
              onChange={(event) => onChange({ ...settings, apiKey: event.target.value })}
            />
          </label>
          <Callout.Root color="teal" variant="surface" className="api-key-tip">
            <Callout.Icon>
              <Info size={16} />
            </Callout.Icon>
            <Callout.Text>
              Create an API key in your OpenAI dashboard, paste it here, then load your available models.{" "}
              <a
                href="https://www.youtube.com/watch?v=SzPE_AE0eEo"
                target="_blank"
                rel="noreferrer"
                className="inline-help-link"
              >
                Watch a quick walkthrough
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </Callout.Text>
          </Callout.Root>
          <label className="field-label">
            Target language
            <TextField.Root
              value={settings.targetLanguage}
              onChange={(event) => onChange({ ...settings, targetLanguage: event.target.value })}
            />
          </label>
          <div className="field-label">
            Model
            <Flex gap="2" align="center">
              <TextField.Root
                className="model-input"
                value={settings.model}
                onChange={(event) => onChange({ ...settings, model: event.target.value })}
              />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Button variant="surface" disabled={models.length === 0}>
                    Choose
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className="model-menu">
                  {models.map((model) => (
                    <DropdownMenu.Item key={model} onClick={() => onChange({ ...settings, model })}>
                      {model}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              <Button variant="soft" disabled={modelsLoading} onClick={() => void refreshModels()}>
                {modelsLoading ? <Spinner /> : null}
                Load models
              </Button>
            </Flex>
            {models.length > 0 ? (
              <Text size="1" color="gray">
                {models.length} text-capable models loaded from your account.
              </Text>
            ) : null}
            {modelsError ? (
              <Text size="1" color="red">
                {modelsError}
              </Text>
            ) : null}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.persistApiKey}
              onChange={(event) => onChange({ ...settings, persistApiKey: event.target.checked })}
            />
            Store API key in localStorage
          </label>

          <Separator size="4" my="2" />

          <label className="field-label">
            <Flex align="center" justify="between" gap="2">
              <span>Your teacher instructions</span>
              {settings.customPrompt !== defaultSettings.customPrompt ? (
                <Button
                  type="button"
                  size="1"
                  variant="ghost"
                  onClick={() => onChange({ ...settings, customPrompt: defaultSettings.customPrompt })}
                >
                  Reset to default
                </Button>
              ) : null}
            </Flex>
            <TextArea
              className="custom-prompt-input"
              rows={10}
              placeholder={CUSTOM_PROMPT_PLACEHOLDER}
              value={settings.customPrompt}
              onChange={(event) => onChange({ ...settings, customPrompt: event.target.value })}
            />
            <Text size="1" color="gray">
              This is the full system prompt sent with every lookup. Edit it to change how the model
              explains Dutch to you — emphasize articles, false friends, register, focus areas. Empty
              field falls back to the default. Lookup cache invalidates automatically on change.
            </Text>
          </label>
        </Flex>

        <Separator my="4" />

        <Flex justify="between" gap="3">
          <Button color="red" variant="soft" onClick={onClearCache}>
            <Trash2 size={15} />
            Clear lookup cache
          </Button>
          <Dialog.Close>
            <Button>Done</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
