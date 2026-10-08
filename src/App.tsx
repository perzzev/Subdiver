import "@radix-ui/themes/styles.css";
import "./styles.css";
import "./themes/reader.css";
import "./themes/cinema.css";
import "./themes/warm.css";

import { Badge, Box, Button, Callout, Flex, Heading, IconButton, Popover, Text, Theme } from "@radix-ui/themes";
import { FileText, HelpCircle, Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logDebug } from "./debug";
import { getLearningHintLevel, requestFollowUp, requestLookup } from "./openai";
import { getSampleUrl, sampleEpisodes, type SampleEpisode } from "./samples";
import { loadSettings, saveSettings } from "./settings";
import { formatTimestamp, parseSubtitleFile } from "./subtitles";
import {
  clearEpisodeChat,
  clearLookupCache,
  deleteLookup,
  loadAllProgress,
  loadEpisodeChat,
  loadLastTranscript,
  listSavedUploads,
  type SavedUpload,
  loadLookup,
  loadReaderProgress,
  loadTranscriptByKey,
  makeLookupCacheKey,
  makeTranscriptKey,
  saveEpisodeChat,
  saveLookup,
  saveReaderProgress,
  saveTranscript,
  setLastTranscriptKey,
} from "./storage";
import { getTheme, loadTheme, saveTheme } from "./theme";
import type {
  AppSettings,
  ChatConversation,
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
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [chatLoading, setChatLoading] = useState(false);
  const [appError, setAppError] = useState("");
  const [progressMap, setProgressMap] = useState<Record<string, ReaderProgress>>(() => loadAllProgress());
  const [savedUploads, setSavedUploads] = useState<SavedUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastResumeKey, setLastResumeKey] = useState<string | undefined>();
  const lookupController = useRef<AbortController | undefined>(undefined);

  const closeLookup = useCallback(() => {
    lookupController.current?.abort();
    lookupController.current = undefined;
    window.getSelection()?.removeAllRanges();
    setLookup(undefined);
  }, []);

  useEffect(() => {
    closeLookup();
    return () => lookupController.current?.abort();
  }, [closeLookup, settings.apiKey, settings.model, settings.targetLanguage, settings.customPrompt, settings.learnerLevel]);

  useAltPressed();

  const debug = useCallback((scope: string, message: string, data?: unknown) => {
    logDebug(scope, message, data);
  }, []);

  // Restore the last opened transcript on mount, but stay on Home — user picks "Continue" to enter.
  useEffect(() => {
    void listSavedUploads().then(setSavedUploads).catch((error) => debug("storage", "Could not load uploads", String(error)));
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

  // Mirror conversations into a ref so async completions read the latest list
  // without stale-closure clobbering (e.g. if a new thread starts mid-request).
  const conversationsRef = useRef<ChatConversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Load chat history whenever the transcript changes.
  useEffect(() => {
    if (!transcript) {
      setConversations([]);
      setActiveConversationId(undefined);
      return;
    }
    const key = makeTranscriptKey(transcript);
    void loadEpisodeChat(key).then((chat) => {
      const convos = chat?.conversations ?? [];
      setConversations(convos);
      setActiveConversationId(convos[0]?.id);
    });
  }, [transcript]);

  async function openTranscriptDocument(doc: TranscriptDocument, options: { resumeFromProgress?: boolean }) {
    const key = makeTranscriptKey(doc);
    await saveTranscript(doc);
    setLastTranscriptKey(key);
    setLastResumeKey(key);
    if (doc.source?.type !== "sample") {
      setSavedUploads((previous) => [{ key, displayTitle: doc.displayTitle, fileName: doc.fileName, kind: doc.kind, author: doc.author }, ...previous.filter((item) => item.key !== key)]);
    }
    setTranscript(doc);
    closeLookup();

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
    if (uploading || loadingSampleSlug) return;
    setAppError("");
    setUploading(true);
    try {
      let doc: TranscriptDocument;
      if (/\.epub$/i.test(file.name)) {
        if (file.size > 30 * 1024 * 1024) throw new Error("This EPUB is too large. Choose a book under 30 MB.");
        const { parseEpubFile } = await import("./epub");
        doc = await parseEpubFile(await file.arrayBuffer(), file.name);
      } else {
        if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error("Choose an EPUB book or a VTT/SRT subtitle file.");
        const rawText = await file.text();
        doc = {
          kind: "subtitles", fileName: file.name, loadedAt: Date.now(),
          cues: parseSubtitleFile(rawText), rawText, source: { type: "upload" },
          displayTitle: file.name.replace(/\.[a-z]+$/i, ""),
        };
      }
      await openTranscriptDocument(doc, { resumeFromProgress: true });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setUploading(false);
    }
  }

  async function openSavedUpload(key: string) {
    setAppError("");
    try {
      const doc = await loadTranscriptByKey(key);
      if (!doc) throw new Error("This file is no longer saved. Please upload it again.");
      await openTranscriptDocument(doc, { resumeFromProgress: true });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not open this file.");
    }
  }

  async function resumeLast() {
    if (!lastResumeKey) return;
    const doc = await loadTranscriptByKey(lastResumeKey);
    if (doc) await openTranscriptDocument(doc, { resumeFromProgress: true });
  }

  function handleBack() {
    setTranscript(undefined);
    closeLookup();
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
    async (request: LookupRequest, bypassCache = false) => {
      lookupController.current?.abort();
      const controller = new AbortController();
      lookupController.current = controller;
      const startedAt = performance.now();
      window.getSelection()?.removeAllRanges();
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
        request.cueText,
        request.mode,
        getLearningHintLevel(request),
      );
      try {
        // Local storage failures should not prevent a translation.
        try {
          if (bypassCache) await deleteLookup(cacheKey);
          const cached = bypassCache ? undefined : await loadLookup(cacheKey);
          if (controller.signal.aborted) return;
          if (cached && !isInvalidCachedLookup(cached)) {
            setLookup({ request, result: cached, loading: false, fromCache: true });
            return;
          }
          if (cached) await deleteLookup(cacheKey);
        } catch (error) {
          debug("storage", "Lookup cache unavailable", String(error));
        }
        if (controller.signal.aborted) return;
        const result = await requestLookup(settings.apiKey, request, {
          customPrompt: settings.customPrompt,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const durationMs = Math.round(performance.now() - startedAt);
        setLookup({ request, result, loading: false, fromCache: false, durationMs });
        debug("lookup", "Translation completed", { model: request.model, mode: request.mode, durationMs });
        if (!isInvalidCachedLookup(result)) {
          void saveLookup(cacheKey, result).catch((error) => debug("storage", "Could not cache translation", String(error)));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setLookup({
          request,
          loading: false,
          fromCache: false,
          error: error instanceof Error && error.name === "TimeoutError"
            ? "Translation took too long. Retry or choose a lighter model in Settings."
            : error instanceof Error ? error.message : "Lookup failed.",
        });
      }
    },
    [debug, settings.apiKey, settings.customPrompt],
  );

  const retryLookup = useCallback(
    (request: LookupRequest) => { void startLookup(request, true); },
    [startLookup],
  );

  const persistConversations = useCallback(
    (convos: ChatConversation[]) => {
      if (!transcript) return;
      void saveEpisodeChat({
        transcriptKey: makeTranscriptKey(transcript),
        conversations: convos.filter((c) => c.messages.length > 0),
        updatedAt: Date.now(),
      });
    },
    [transcript],
  );

  // "Ask follow-up" always opens a fresh thread on top, seeded with the word
  // that's currently looked up. Empty threads (opened but never asked) are
  // pruned so repeated clicks don't stack blank dialogs.
  const handleAskFollowUp = useCallback(() => {
    setChatOpen(true);
    const now = Date.now();
    const conversation: ChatConversation = {
      id: `${now}-c`,
      createdAt: now,
      updatedAt: now,
      contextSelection: lookup?.request.targetText,
      contextCueId: lookup?.request.cueId,
      contextCueText: lookup?.request.cueText,
      contextMode: lookup?.request.mode,
      messages: [],
    };
    setConversations((prev) => [conversation, ...prev.filter((c) => c.messages.length > 0)]);
    setActiveConversationId(conversation.id);
  }, [lookup]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    // Drop any other empty (unasked) threads when leaving one.
    setConversations((prev) => prev.filter((c) => c.messages.length > 0 || c.id === id));
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        persistConversations(next);
        if (id === activeConversationId) setActiveConversationId(next[0]?.id);
        return next;
      });
    },
    [activeConversationId, persistConversations],
  );

  const handleChatSubmit = useCallback(
    async (question: string) => {
      if (!transcript) return;
      const trimmed = question.trim();
      if (!trimmed) return;

      const now = Date.now();

      // Find the active thread, or open one from the current lookup on the fly.
      let convos = conversationsRef.current;
      let convoId = activeConversationId;
      if (!convoId || !convos.some((c) => c.id === convoId)) {
        const created: ChatConversation = {
          id: `${now}-c`,
          createdAt: now,
          updatedAt: now,
          contextSelection: lookup?.request.targetText,
          contextCueId: lookup?.request.cueId,
          contextCueText: lookup?.request.cueText,
          contextMode: lookup?.request.mode,
          messages: [],
        };
        convos = [created, ...convos.filter((c) => c.messages.length > 0)];
        convoId = created.id;
        setActiveConversationId(convoId);
      }

      const activeConvo = convos.find((c) => c.id === convoId)!;
      const baseRequest: LookupRequest = {
        targetText: activeConvo.contextSelection ?? "",
        cueText: activeConvo.contextCueText ?? "",
        cueId: activeConvo.contextCueId ?? "",
        cueStartMs: 0,
        cueEndMs: 0,
        targetLanguage: settings.targetLanguage,
        model: settings.model,
        mode: activeConvo.contextMode ?? "selection",
      };

      const userMessage: EpisodeChatMessage = {
        id: `${now}-u`,
        role: "user",
        content: trimmed,
        createdAt: now,
      };

      const afterUser = appendToConversation(convos, convoId, userMessage);
      setConversations(afterUser);
      persistConversations(afterUser);
      setChatLoading(true);

      const priorMessages = [...activeConvo.messages, userMessage];
      try {
        const answer = await requestFollowUp(settings.apiKey, baseRequest, priorMessages, trimmed, {
          customPrompt: settings.customPrompt,
        });
        const assistantMessage: EpisodeChatMessage = {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: answer || "(empty response)",
          createdAt: Date.now(),
        };
        const next = appendToConversation(conversationsRef.current, convoId, assistantMessage);
        setConversations(next);
        persistConversations(next);
      } catch (error) {
        const errorMessage: EpisodeChatMessage = {
          id: `${Date.now()}-e`,
          role: "assistant",
          content: error instanceof Error ? error.message : "Follow-up request failed.",
          createdAt: Date.now(),
        };
        const next = appendToConversation(conversationsRef.current, convoId, errorMessage);
        setConversations(next);
        persistConversations(next);
      } finally {
        setChatLoading(false);
      }
    },
    [
      activeConversationId,
      lookup,
      persistConversations,
      settings.apiKey,
      settings.customPrompt,
      settings.model,
      settings.targetLanguage,
      transcript,
    ],
  );

  const handleClearChat = useCallback(async () => {
    if (!transcript) return;
    if (!window.confirm(`Clear all chat history for this ${transcript.kind === "epub" ? "book" : "episode"}?`)) return;
    await clearEpisodeChat(makeTranscriptKey(transcript));
    setConversations([]);
    setActiveConversationId(undefined);
  }, [transcript]);

  const handleJumpToCue = useCallback((cueId: string) => {
    setPendingScrollCueId(cueId);
  }, []);

  async function resetCache() {
    closeLookup();
    await clearLookupCache();
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
    const upload = savedUploads.find((item) => item.key === lastResumeKey);
    const title = sample ? `${sample.title} · S${sample.season}E${sample.episode}` : upload?.displayTitle ?? upload?.fileName ?? "Continue your upload";
    const cueIndex = progress.cueIndex ?? 0;
    const totalCues = progress.totalCues;
    const ratio = totalCues ? Math.round(((cueIndex + 1) / totalCues) * 100) : 0;
    const subtitle = `${upload?.kind === "epub" ? "Passage" : "Cue"} ${cueIndex + 1} of ${totalCues} · ${ratio}% read`;
    return { title, subtitle, progress, onResume: () => void resumeLast() };
  }, [lastResumeKey, progressMap, savedUploads]);

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
                Read Dutch subtitles & books, word by word
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
                    <strong>Click a word</strong> for an in-context translation. It stays beside
                    the text on wide screens and in a compact bottom panel on smaller screens.
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
                    <strong>Reading chat</strong> gives every word you ask about its own thread —
                    the newest opens on top, and you can switch between them to review the words and
                    constructions that puzzled you.
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

        <main className={`app-layout ${transcript ? "reading-layout" : ""} ${chatOpen && transcript ? "with-panel" : ""}`}>
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
                key={makeTranscriptKey(transcript)}
                transcript={transcript}
                cues={transcript.cues}
                settings={settings}
                lookup={lookup}
                resumeCueId={pendingScrollCueId}
                chatBadge={conversations.reduce((total, c) => total + c.messages.length, 0)}
                chatOpen={chatOpen}
                onResumeComplete={() => setPendingScrollCueId(undefined)}
                onVisibleCueChange={handleVisibleCueChange}
                onLookup={(req) => void startLookup(req)}
                onCloseLookup={closeLookup}
                onRetryLookup={retryLookup}
                onAskFollowUp={handleAskFollowUp}
                onBack={handleBack}
                onToggleChat={() => setChatOpen((open) => !open)}
                onDebug={debug}
              />
            ) : (
              <Home
                savedUploads={savedUploads}
                uploading={uploading}
                onOpenUpload={(key) => void openSavedUpload(key)}
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
              contentLabel={transcript.kind === "epub" ? "book" : "episode"}
              open={chatOpen}
              conversations={conversations}
              activeConversationId={activeConversationId}
              loading={chatLoading}
              onSubmit={handleChatSubmit}
              onSelectConversation={handleSelectConversation}
              onDeleteConversation={handleDeleteConversation}
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

function appendToConversation(
  conversations: ChatConversation[],
  id: string,
  message: EpisodeChatMessage,
): ChatConversation[] {
  return conversations.map((conversation) =>
    conversation.id === id
      ? {
          ...conversation,
          messages: [...conversation.messages, message],
          updatedAt: message.createdAt,
        }
      : conversation,
  );
}

function isInvalidCachedLookup(result: LookupResult) {
  if (typeof result.translation !== "string" || typeof result.explanation !== "string") return true;
  const translation = result.translation.trim().toLowerCase();
  const explanation = result.explanation.trim().toLowerCase();
  return (
    !translation ||
    translation === "no response text returned." ||
    translation.includes("no response text returned") ||
    explanation === "the model returned plain text instead of structured json."
  );
}
