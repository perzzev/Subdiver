import "@radix-ui/themes/styles.css";
import "./styles.css";
import "./themes/reader.css";
import "./themes/cinema.css";
import "./themes/warm.css";

import { Badge, Box, Button, Callout, Flex, Heading, IconButton, Popover, Text, Theme } from "@radix-ui/themes";
import { FileText, HelpCircle, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { logDebug } from "./debug";
import { requestFollowUp, requestLookup } from "./openai";
import { getSampleUrl, sampleEpisodes, type SampleEpisode } from "./samples";
import { loadSettings, saveSettings } from "./settings";
import { formatTimestamp, parseSubtitleFile } from "./subtitles";
import {
  appendEpisodeChat,
  clearEpisodeChat,
  clearLookupCache,
  deleteLookup,
  loadAllProgress,
  loadEpisodeChat,
  loadLastTranscript,
  loadLookup,
  loadReaderProgress,
  loadTranscriptByKey,
  makeLookupCacheKey,
  makeTranscriptKey,
  saveLookup,
  saveReaderProgress,
  saveTranscript,
  setLastTranscriptKey,
} from "./storage";
import { getTheme, loadTheme, saveTheme } from "./theme";
import type {
  AppSettings,
  EpisodeChatMessage,
  LookupRequest,
  LookupResult,
  LookupState,
  ReaderProgress,
  ThemeId,
  TranscriptDocument,
} from "./types";
import { useAltPressed } from "./utils/useAltPressed";
import { EpisodeChatPanel } from "./components/EpisodeChatPanel";
import { Home } from "./components/Home";
import { Reader } from "./components/Reader";
import { SettingsDialog } from "./components/SettingsDialog";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { getCueDomId } from "./components/CueRow";

type SampleStats = { cues: number; duration: string };

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [themeId, setThemeId] = useState<ThemeId>(() => loadTheme());
  const [transcript, setTranscript] = useState<TranscriptDocument | undefined>();
  const [pendingScrollCueId, setPendingScrollCueId] = useState<string | undefined>();
  const [sampleStats, setSampleStats] = useState<Record<string, SampleStats>>({});
  const [loadingSampleSlug, setLoadingSampleSlug] = useState("");
  const [lookup, setLookup] = useState<LookupState | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<EpisodeChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [appError, setAppError] = useState("");
  const [progressMap, setProgressMap] = useState<Record<string, ReaderProgress>>(() => loadAllProgress());
  const [lastResumeKey, setLastResumeKey] = useState<string | undefined>();

  useAltPressed();

  const debug = useCallback((scope: string, message: string, data?: unknown) => {
    logDebug(scope, message, data);
  }, []);

  // Restore the last opened transcript on mount, but stay on Home — user picks "Continue" to enter.
  useEffect(() => {
    void loadLastTranscript()
      .then(async (doc) => {
        if (!doc) return;
        const key = makeTranscriptKey(doc);
        setLastResumeKey(key);
        debug("storage", "Found a previous session", { key, fileName: doc.fileName });
      })
      .catch((error) => debug("storage", "Could not check previous session", String(error)));
  }, [debug]);

  // Save settings (debounced).
  useEffect(() => {
    const id = window.setTimeout(() => saveSettings(settings), 250);
    return () => window.clearTimeout(id);
  }, [settings]);

  // Persist theme.
  useEffect(() => {
    saveTheme(themeId);
    document.documentElement.setAttribute("data-theme", themeId);
  }, [themeId]);

  // Sample metadata loader.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const nextStats: Record<string, SampleStats> = {};
      await Promise.all(
        sampleEpisodes.map(async (sample) => {
          try {
            const rawText = await fetch(getSampleUrl(sample.fileName)).then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.text();
            });
            const cues = parseSubtitleFile(rawText);
            nextStats[sample.slug] = {
              cues: cues.length,
              duration: cues.length ? formatTimestamp(cues[cues.length - 1].endMs) : "",
            };
          } catch (error) {
            debug("samples", "Could not load sample metadata", String(error));
          }
        }),
      );
      if (!cancelled) setSampleStats(nextStats);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [debug]);

  // Load chat history whenever the transcript changes.
  useEffect(() => {
    if (!transcript) {
      setChatMessages([]);
      return;
    }
    const key = makeTranscriptKey(transcript);
    void loadEpisodeChat(key).then((chat) => {
      setChatMessages(chat?.messages ?? []);
    });
  }, [transcript]);

  async function openTranscriptDocument(doc: TranscriptDocument, options: { resumeFromProgress?: boolean }) {
    const key = makeTranscriptKey(doc);
    await saveTranscript(doc);
    setLastTranscriptKey(key);
    setLastResumeKey(key);
    setTranscript(doc);
    setLookup(undefined);

    if (options.resumeFromProgress) {
      const progress = loadReaderProgress(key);
      setPendingScrollCueId(progress?.cueId);
    } else {
      setPendingScrollCueId(undefined);
      const firstCue = doc.cues[0];
      if (firstCue) {
        const progress: ReaderProgress = {
          transcriptKey: key,
          cueId: firstCue.id,
          updatedAt: Date.now(),
          totalCues: doc.cues.length,
          cueIndex: 0,
        };
        saveReaderProgress(progress);
        setProgressMap((prev) => ({ ...prev, [key]: progress }));
      }
    }
  }

  async function loadSample(sample: SampleEpisode) {
    setAppError("");
    setLoadingSampleSlug(sample.slug);
    try {
      // If we already have this sample saved, reopen it without refetching.
      const key = `sample:${sample.slug}`;
      const existing = await loadTranscriptByKey(key);
      if (existing) {
        await openTranscriptDocument(existing, { resumeFromProgress: true });
        return;
      }
      const rawText = await fetch(getSampleUrl(sample.fileName)).then((response) => {
        if (!response.ok) throw new Error(`Could not load sample subtitle (${response.status}).`);
        return response.text();
      });
      const cues = parseSubtitleFile(rawText);
      const doc: TranscriptDocument = {
        fileName: `${sample.title}.nl.vtt`,
        loadedAt: Date.now(),
        cues,
        rawText,
        source: { type: "sample", sampleSlug: sample.slug },
        displayTitle: `${sample.title} · S${sample.season}E${sample.episode}`,
      };
      await openTranscriptDocument(doc, { resumeFromProgress: false });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not load this sample.");
    } finally {
      setLoadingSampleSlug("");
    }
  }

  async function handleFile(file: File) {
    setAppError("");
    try {
      const rawText = await file.text();
      const cues = parseSubtitleFile(rawText);
      const doc: TranscriptDocument = {
        fileName: file.name,
        loadedAt: Date.now(),
        cues,
        rawText,
        source: { type: "upload" },
        displayTitle: file.name.replace(/\.[a-z]+$/i, ""),
      };
      await openTranscriptDocument(doc, { resumeFromProgress: false });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not parse this subtitle file.");
    }
  }

  async function resumeLast() {
    if (!lastResumeKey) return;
    const doc = await loadTranscriptByKey(lastResumeKey);
    if (doc) await openTranscriptDocument(doc, { resumeFromProgress: true });
  }

  function handleBack() {
    setTranscript(undefined);
    setLookup(undefined);
    setChatOpen(false);
    setProgressMap(loadAllProgress());
  }

  const handleVisibleCueChange = useCallback(
    (cueId: string, index: number) => {
      if (!transcript) return;
      const key = makeTranscriptKey(transcript);
      const progress: ReaderProgress = {
        transcriptKey: key,
        cueId,
        updatedAt: Date.now(),
        totalCues: transcript.cues.length,
        cueIndex: index,
      };
      saveReaderProgress(progress);
      setProgressMap((prev) => ({ ...prev, [key]: progress }));
    },
    [transcript],
  );

  const startLookup = useCallback(
    async (request: LookupRequest) => {
      setAppError("");
      setLookup({ request, loading: true, fromCache: false });

      if (!settings.apiKey.trim()) {
        setLookup({
          request,
          loading: false,
          fromCache: false,
          error: "Add your OpenAI API key in Settings before requesting translations.",
        });
        setSettingsOpen(true);
        return;
      }

      const cacheKey = makeLookupCacheKey(
        request.model,
        request.targetLanguage,
        request.targetText,
        settings.customPrompt,
      );
      const cached = await loadLookup(cacheKey);
      if (cached && !isInvalidCachedLookup(cached)) {
        setLookup({ request, result: cached, loading: false, fromCache: true });
        return;
      }
      if (cached) await deleteLookup(cacheKey);

      try {
        const result = await requestLookup(settings.apiKey, request, {
          customPrompt: settings.customPrompt,
        });
        if (!isInvalidCachedLookup(result)) await saveLookup(cacheKey, result);
        setLookup({ request, result, loading: false, fromCache: false });
      } catch (error) {
        setLookup({
          request,
          loading: false,
          fromCache: false,
          error: error instanceof Error ? error.message : "Lookup failed.",
        });
      }
    },
    [settings.apiKey, settings.customPrompt, settings.model, settings.targetLanguage],
  );

  const retryLookup = useCallback(
    async (request: LookupRequest) => {
      const cacheKey = makeLookupCacheKey(
        request.model,
        request.targetLanguage,
        request.targetText,
        settings.customPrompt,
      );
      await deleteLookup(cacheKey);
      await startLookup(request);
    },
    [settings.customPrompt, startLookup],
  );

  const handleAskFollowUp = useCallback(() => {
    setChatOpen(true);
  }, []);

  const handleChatSubmit = useCallback(
    async (question: string) => {
      if (!transcript) return;
      const trimmed = question.trim();
      if (!trimmed) return;

      const transcriptKey = makeTranscriptKey(transcript);
      const now = Date.now();

      // Build a context request: prefer current lookup, otherwise the most recent assistant context.
      const lastWith = <K extends keyof EpisodeChatMessage>(key: K): EpisodeChatMessage | undefined => {
        for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
          if (chatMessages[i][key]) return chatMessages[i];
        }
        return undefined;
      };
      const baseRequest: LookupRequest = lookup?.request ?? {
        targetText: lastWith("contextSelection")?.contextSelection ?? "",
        cueText: lastWith("contextCueText")?.contextCueText ?? "",
        cueId: lastWith("contextCueId")?.contextCueId ?? "",
        cueStartMs: 0,
        cueEndMs: 0,
        targetLanguage: settings.targetLanguage,
        model: settings.model,
        mode: "selection",
      };

      const userMessage: EpisodeChatMessage = {
        id: `${now}-u`,
        role: "user",
        content: trimmed,
        createdAt: now,
        contextSelection: lookup?.request.targetText,
        contextCueId: lookup?.request.cueId,
        contextCueText: lookup?.request.cueText,
      };

      setChatLoading(true);
      const optimistic = [...chatMessages, userMessage];
      setChatMessages(optimistic);
      await appendEpisodeChat(transcriptKey, [userMessage]);

      try {
        const answer = await requestFollowUp(settings.apiKey, baseRequest, optimistic, trimmed, {
          customPrompt: settings.customPrompt,
        });
        const assistantMessage: EpisodeChatMessage = {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: answer || "(empty response)",
          createdAt: Date.now(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        await appendEpisodeChat(transcriptKey, [assistantMessage]);
      } catch (error) {
        const errorMessage: EpisodeChatMessage = {
          id: `${Date.now()}-e`,
          role: "assistant",
          content: error instanceof Error ? error.message : "Follow-up request failed.",
          createdAt: Date.now(),
        };
        setChatMessages((prev) => [...prev, errorMessage]);
        await appendEpisodeChat(transcriptKey, [errorMessage]);
      } finally {
        setChatLoading(false);
      }
    },
    [
      chatMessages,
      lookup,
      settings.apiKey,
      settings.customPrompt,
      settings.model,
      settings.targetLanguage,
      transcript,
    ],
  );

  const handleClearChat = useCallback(async () => {
    if (!transcript) return;
    if (!window.confirm("Clear all chat history for this episode?")) return;
    await clearEpisodeChat(makeTranscriptKey(transcript));
    setChatMessages([]);
  }, [transcript]);

  const handleJumpToCue = useCallback((cueId: string) => {
    const el = document.getElementById(getCueDomId(cueId));
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("cue-row-flash");
      window.setTimeout(() => el.classList.remove("cue-row-flash"), 1400);
    }
  }, []);

  async function resetCache() {
    await clearLookupCache();
    setLookup(undefined);
  }

  const continueInfo = useMemo(() => {
    if (!lastResumeKey) return undefined;
    const progress = progressMap[lastResumeKey];
    // No tracked progress (e.g. user cleared localStorage) → no continue card,
    // even if a stale transcript still lives in IndexedDB.
    if (!progress || progress.totalCues === undefined) return undefined;
    const sample = lastResumeKey.startsWith("sample:")
      ? sampleEpisodes.find((s) => `sample:${s.slug}` === lastResumeKey)
      : undefined;
    const title = sample ? `${sample.title} · S${sample.season}E${sample.episode}` : "Continue your upload";
    const cueIndex = progress.cueIndex ?? 0;
    const totalCues = progress.totalCues;
    const ratio = totalCues ? Math.round(((cueIndex + 1) / totalCues) * 100) : 0;
    const subtitle = `Cue ${cueIndex + 1} of ${totalCues} · ${ratio}% read`;
    return { title, subtitle, progress, onResume: () => void resumeLast() };
  }, [lastResumeKey, progressMap]);

  const theme = getTheme(themeId);
  const hasApiKey = Boolean(settings.apiKey.trim());

  return (
    <Theme
      accentColor={theme.accentColor}
      grayColor={theme.grayColor}
      radius="medium"
      scaling="100%"
      appearance={theme.appearance}
      hasBackground={false}
    >
      <div className={`app-shell theme-${themeId}`}>
        <header className="topbar">
          <button
            type="button"
            className="brand-button"
            onClick={handleBack}
            aria-label="Go to library"
          >
            <span className="brand-mark">
              <FileText size={19} />
            </span>
            <span className="brand-text">
              <Heading as="h1" size="4">
                Subdiver
              </Heading>
              <Text size="1" color="gray">
                Dive under Dutch subtitles, word by word
              </Text>
            </span>
          </button>

          <Flex align="center" gap="2">
            <Popover.Root>
              <Popover.Trigger>
                <IconButton variant="surface" aria-label="How to use Subdiver">
                  <HelpCircle size={17} />
                </IconButton>
              </Popover.Trigger>
              <Popover.Content size="2" maxWidth="360px">
                <Flex direction="column" gap="2">
                  <Heading as="h3" size="3">
                    How to use Subdiver
                  </Heading>
                  <Text size="2" color="gray" as="p">
                    <strong>Click a word</strong> for an instant in-context translation. The card
                    appears under the subtitle line.
                  </Text>
                  <Text size="2" color="gray" as="p">
                    <strong>Hold <kbd>Alt</kbd></strong> (Option on Mac) and hover to highlight the
                    whole sentence — click confirms and translates it with a short grammar note.
                    There's also a <kbd>¶</kbd> button next to each sentence if you prefer mouse only.
                  </Text>
                  <Text size="2" color="gray" as="p">
                    <strong>Select a phrase</strong> with the mouse to translate just that fragment.
                  </Text>
                  <Text size="2" color="gray" as="p">
                    <strong>Episode chat</strong> stores every follow-up you ask, per episode — come
                    back later to review the words and constructions that puzzled you.
                  </Text>
                  <Text size="2" color="gray" as="p">
                    Press <kbd>Esc</kbd> to close a translation card.
                  </Text>
                </Flex>
              </Popover.Content>
            </Popover.Root>
            <ThemeSwitcher themeId={themeId} onChange={setThemeId} />
            <SettingsDialog
              settings={settings}
              onChange={setSettings}
              onClearCache={() => void resetCache()}
              onDebug={debug}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
          </Flex>
        </header>

        <main className={`app-layout ${chatOpen && transcript ? "with-panel" : ""}`}>
          <section className="app-main">
            {appError ? (
              <Callout.Root color="red" mb="4">
                <Callout.Icon>
                  <Info size={16} />
                </Callout.Icon>
                <Callout.Text>{appError}</Callout.Text>
              </Callout.Root>
            ) : null}

            {transcript ? (
              <Reader
                transcript={transcript}
                cues={transcript.cues}
                settings={settings}
                lookup={lookup}
                resumeCueId={pendingScrollCueId}
                chatBadge={chatMessages.length}
                onResumeComplete={() => setPendingScrollCueId(undefined)}
                onVisibleCueChange={handleVisibleCueChange}
                onLookup={(req) => void startLookup(req)}
                onCloseLookup={() => setLookup(undefined)}
                onRetryLookup={retryLookup}
                onAskFollowUp={handleAskFollowUp}
                onBack={handleBack}
                onToggleChat={() => setChatOpen((open) => !open)}
                onDebug={debug}
              />
            ) : (
              <Home
                hasApiKey={hasApiKey}
                loadingSampleSlug={loadingSampleSlug}
                sampleStats={sampleStats}
                sampleProgress={progressMap}
                continueInfo={continueInfo}
                onOpenSettings={() => setSettingsOpen(true)}
                onSample={(sample) => void loadSample(sample)}
                onUploadFile={(file) => void handleFile(file)}
              />
            )}
          </section>

          {transcript ? (
            <EpisodeChatPanel
              open={chatOpen}
              messages={chatMessages}
              loading={chatLoading}
              pendingContext={lookup}
              onSubmit={handleChatSubmit}
              onClose={() => setChatOpen(false)}
              onClear={() => void handleClearChat()}
              onJumpToCue={handleJumpToCue}
            />
          ) : null}
        </main>

        <footer className="app-footer">
          <Text size="1" color="gray">
            Free for learning · MIT licensed · Your data stays in this browser ·{" "}
            <a href="https://github.com/" target="_blank" rel="noreferrer">
              README
            </a>
          </Text>
        </footer>
      </div>
    </Theme>
  );
}

function isInvalidCachedLookup(result: LookupResult) {
  const translation = result.translation.trim().toLowerCase();
  const explanation = result.explanation.trim().toLowerCase();
  return (
    !translation ||
    translation === "no response text returned." ||
    translation.includes("no response text returned") ||
    explanation === "the model returned plain text instead of structured json."
  );
}
