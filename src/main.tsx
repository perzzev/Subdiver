import "@radix-ui/themes/styles.css";
import "./styles.css";

import { StrictMode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  Box,
  Button,
  Callout,
  Code,
  DropdownMenu,
  Dialog,
  Flex,
  Heading,
  IconButton,
  ScrollArea,
  Separator,
  Spinner,
  Text,
  TextArea,
  TextField,
  Theme,
} from "@radix-ui/themes";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  FolderOpen,
  GraduationCap,
  Info,
  MessageSquareText,
  PanelRightClose,
  Play,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { logDebug } from "./debug";
import { listOpenAiModels, requestFollowUp, requestLookup } from "./openai";
import { getSampleUrl, sampleEpisodes, type SampleEpisode } from "./samples";
import { loadSettings, saveSettings } from "./settings";
import { formatTimestamp, parseSubtitleFile, tokenizeCueText } from "./subtitles";
import {
  clearLookupCache,
  clearReaderProgress,
  clearTranscript,
  deleteLookup,
  loadReaderProgress,
  loadLookup,
  loadTranscript,
  makeLookupCacheKey,
  makeTranscriptKey,
  saveReaderProgress,
  saveLookup,
  saveTranscript,
} from "./storage";
import type {
  AppSettings,
  FollowUpMessage,
  LookupRequest,
  LookupResult,
  LookupState,
  SubtitleCue,
  TranscriptDocument,
} from "./types";

type SampleStats = {
  cues: number;
  duration: string;
};

function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [transcript, setTranscript] = useState<TranscriptDocument | undefined>();
  const [pendingScrollCueId, setPendingScrollCueId] = useState<string | undefined>();
  const [sampleStats, setSampleStats] = useState<Record<string, SampleStats>>({});
  const [loadingSampleSlug, setLoadingSampleSlug] = useState("");
  const [lookup, setLookup] = useState<LookupState | undefined>();
  const [lookupAnchor, setLookupAnchor] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [appError, setAppError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debug = useCallback((scope: string, message: string, data?: unknown) => {
    logDebug(scope, message, data);
  }, []);

  useEffect(() => {
    loadTranscript()
      .then((loaded) => {
        if (loaded) {
          const progress = loadReaderProgress();
          const transcriptKey = makeTranscriptKey(loaded);
          debug("storage", "Loaded persisted transcript", {
            fileName: loaded.fileName,
            cues: loaded.cues.length,
            progress,
            transcriptKey,
          });
          if (progress?.transcriptKey === transcriptKey) setPendingScrollCueId(progress.cueId);
        }
        setTranscript(loaded);
      })
      .catch((error) => debug("storage", "Could not load persisted transcript", String(error)));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSampleStats() {
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
            debug("samples", "Could not load sample metadata", {
              sample: sample.slug,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );
      if (!cancelled) setSampleStats(nextStats);
    }

    void loadSampleStats();
    return () => {
      cancelled = true;
    };
  }, [debug]);

  useEffect(() => {
    const id = window.setTimeout(() => saveSettings(settings), 250);
    return () => window.clearTimeout(id);
  }, [settings]);

  useEffect(() => {
    if (!lookup) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".lookup-popup")) return;
      if (target.closest(".side-panel")) return;
      if (target.closest(".word-token")) return;
      debug("lookup", "Closing popup after outside click");
      setLookup(undefined);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [lookup]);

  const cueCount = transcript?.cues.length ?? 0;
  const duration = transcript?.cues.length ? formatTimestamp(transcript.cues[transcript.cues.length - 1].endMs) : "";

  async function handleFile(file: File) {
    setAppError("");
    debug("file", "File selected", { name: file.name, size: file.size, type: file.type });
    try {
      const rawText = await file.text();
      const cues = parseSubtitleFile(rawText);
      const nextDocument = {
        fileName: file.name,
        loadedAt: Date.now(),
        cues,
        rawText,
        source: { type: "upload" as const },
      };
      setTranscript(nextDocument);
      setPendingScrollCueId(undefined);
      setLookup(undefined);
      setMessages([]);
      await saveTranscript(nextDocument);
      if (cues[0]) {
        saveReaderProgress({
          transcriptKey: makeTranscriptKey(nextDocument),
          cueId: cues[0].id,
          updatedAt: Date.now(),
        });
      }
      debug("file", "Subtitle parsed and saved", { fileName: file.name, cues: cues.length });
    } catch (error) {
      debug("file", "Subtitle parse failed", error instanceof Error ? error.message : String(error));
      setAppError(error instanceof Error ? error.message : "Could not parse this subtitle file.");
    }
  }

  async function loadSample(sample: SampleEpisode) {
    setAppError("");
    setLoadingSampleSlug(sample.slug);
    debug("samples", "Loading sample transcript", sample);
    try {
      const rawText = await fetch(getSampleUrl(sample.fileName)).then((response) => {
        if (!response.ok) throw new Error(`Could not load sample subtitle (${response.status}).`);
        return response.text();
      });
      const cues = parseSubtitleFile(rawText);
      const nextDocument: TranscriptDocument = {
        fileName: `${sample.title}.nl.vtt`,
        loadedAt: Date.now(),
        cues,
        rawText,
        source: { type: "sample", sampleSlug: sample.slug },
      };
      setTranscript(nextDocument);
      setPendingScrollCueId(undefined);
      setLookup(undefined);
      setMessages([]);
      await saveTranscript(nextDocument);
      if (cues[0]) {
        saveReaderProgress({
          transcriptKey: makeTranscriptKey(nextDocument),
          cueId: cues[0].id,
          updatedAt: Date.now(),
        });
      }
      debug("samples", "Sample transcript loaded", { slug: sample.slug, cues: cues.length });
    } catch (error) {
      debug("samples", "Sample load failed", error instanceof Error ? error.message : String(error));
      setAppError(error instanceof Error ? error.message : "Could not load this sample transcript.");
    } finally {
      setLoadingSampleSlug("");
    }
  }

  const handleVisibleCueChange = useCallback(
    (cueId: string) => {
      if (!transcript) return;
      saveReaderProgress({
        transcriptKey: makeTranscriptKey(transcript),
        cueId,
        updatedAt: Date.now(),
      });
    },
    [transcript],
  );

  const startLookup = useCallback(
    async (request: LookupRequest, anchor: { x: number; y: number }) => {
      debug("lookup", "Start lookup", { request, anchor });
      setAppError("");
      setLookupAnchor(anchor);
      setSidePanelOpen(false);
      setMessages([]);
      setLookup({ request, loading: true, fromCache: false });

      if (!settings.apiKey.trim()) {
        debug("lookup", "Blocked: missing API key");
        setLookup({
          request,
          loading: false,
          fromCache: false,
          error: "Add your OpenAI API key in Settings before requesting translations.",
        });
        setSettingsOpen(true);
        return;
      }

      const cacheKey = makeLookupCacheKey(request.model, request.targetLanguage, request.targetText);
      debug("cache", "Checking lookup cache", { cacheKey });
      const cached = await loadLookup(cacheKey);
      if (cached) {
        if (isInvalidCachedLookup(cached)) {
          debug("cache", "Deleting invalid cached lookup", { cacheKey, result: cached });
          await deleteLookup(cacheKey);
        } else {
          debug("cache", "Cache hit", { cacheKey, result: cached });
          setLookup({ request, result: cached, loading: false, fromCache: true });
          return;
        }
      }

      try {
        debug("openai", "Sending lookup request", { model: request.model, targetText: request.targetText });
        const result = await requestLookup(settings.apiKey, request);
        if (isInvalidCachedLookup(result)) {
          debug("cache", "Skipping invalid lookup cache write", { cacheKey, result });
        } else {
          await saveLookup(cacheKey, result);
        }
        debug("openai", "Lookup response received", result);
        setLookup({ request, result, loading: false, fromCache: false });
      } catch (error) {
        debug("openai", "Lookup failed", error instanceof Error ? error.message : String(error));
        setLookup({
          request,
          loading: false,
          fromCache: false,
          error: error instanceof Error ? error.message : "Lookup failed.",
        });
      }
    },
    [debug, settings.apiKey, settings.model, settings.targetLanguage],
  );

  const retryLookup = useCallback(
    async (request: LookupRequest) => {
      const cacheKey = makeLookupCacheKey(request.model, request.targetLanguage, request.targetText);
      await deleteLookup(cacheKey);
      debug("cache", "Deleted lookup cache before retry", { cacheKey });
      await startLookup(request, lookupAnchor);
    },
    [debug, lookupAnchor, startLookup],
  );

  const handleFollowUp = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || !lookup?.request || followUpLoading) return;
      debug("followup", "Sending follow-up", { question: trimmed, targetText: lookup.request.targetText });

      const userMessage: FollowUpMessage = { role: "user", content: trimmed, createdAt: Date.now() };
      setFollowUpLoading(true);
      let nextMessages: FollowUpMessage[] = [];
      setMessages((prev) => {
        nextMessages = [...prev, userMessage];
        return nextMessages;
      });

      try {
        const answer = await requestFollowUp(settings.apiKey, lookup.request, nextMessages, trimmed);
        debug("followup", "Follow-up response received", { answer });
        setMessages((prev) => [...prev, { role: "assistant", content: answer, createdAt: Date.now() }]);
      } catch (error) {
        debug("followup", "Follow-up failed", error instanceof Error ? error.message : String(error));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: error instanceof Error ? error.message : "Follow-up request failed.",
            createdAt: Date.now(),
          },
        ]);
      } finally {
        setFollowUpLoading(false);
      }
    },
    [debug, followUpLoading, lookup, settings.apiKey],
  );

  async function resetTranscript() {
    debug("storage", "Clearing transcript");
    setTranscript(undefined);
    setLookup(undefined);
    setMessages([]);
    clearReaderProgress();
    await clearTranscript();
  }

  async function resetCache() {
    await clearLookupCache();
    debug("cache", "Lookup cache cleared");
    setLookup(undefined);
  }

  return (
    <Theme accentColor="teal" grayColor="sage" radius="medium" scaling="100%">
      <div className="app-shell">
        <header className="topbar">
          <Flex align="center" gap="3">
            <div className="brand-mark">
              <FileText size={19} />
            </div>
            <Box>
              <Heading as="h1" size="4">
                Subdiver
              </Heading>
              <Text size="1" color="gray">
                Dive under Dutch subtitles with contextual translation
              </Text>
            </Box>
          </Flex>

          <Flex align="center" gap="2">
            {!settings.apiKey.trim() ? (
              <Badge color="amber" variant="surface">
                API key needed
              </Badge>
            ) : (
              <Badge color="green" variant="surface">
                Ready
              </Badge>
            )}
            {transcript ? (
              <Badge color="gray" variant="surface">
                {cueCount} cues · {duration}
              </Badge>
            ) : null}
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept=".vtt,.srt,text/vtt,application/x-subrip,text/plain"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void handleFile(file);
                event.currentTarget.value = "";
              }}
            />
            <Button variant="surface" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              Upload subtitles
            </Button>
            <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Dialog.Trigger>
                <IconButton variant="surface" aria-label="Settings">
                  <Settings size={17} />
                </IconButton>
              </Dialog.Trigger>
              <SettingsDialog settings={settings} onChange={setSettings} onClearCache={resetCache} onDebug={debug} />
            </Dialog.Root>
          </Flex>
        </header>

        <main className={`reader-layout ${sidePanelOpen ? "with-panel" : ""}`}>
          <section className="reader-main">
            {appError ? (
              <Callout.Root color="red" mb="4">
                <Callout.Icon>
                  <Info size={16} />
                </Callout.Icon>
                <Callout.Text>{appError}</Callout.Text>
              </Callout.Root>
            ) : null}

            {transcript ? (
              <>
                <Flex className="file-strip" align="center" justify="between" gap="3">
                  <Box>
                    <Text weight="bold">{transcript.fileName}</Text>
                    <Text size="2" color="gray" ml="2">
                      loaded {new Date(transcript.loadedAt).toLocaleString()}
                    </Text>
                  </Box>
                  <Button color="red" variant="ghost" onClick={() => void resetTranscript()}>
                    <Trash2 size={15} />
                    Remove
                  </Button>
                </Flex>
                <Transcript
                  cues={transcript.cues}
                  settings={settings}
                  resumeCueId={pendingScrollCueId}
                  onResumeComplete={() => setPendingScrollCueId(undefined)}
                  onVisibleCueChange={handleVisibleCueChange}
                  onLookup={startLookup}
                  onDebug={debug}
                />
              </>
            ) : (
              <HomeCatalog
                hasApiKey={Boolean(settings.apiKey.trim())}
                loadingSampleSlug={loadingSampleSlug}
                sampleStats={sampleStats}
                onOpenSettings={() => setSettingsOpen(true)}
                onSample={(sample) => void loadSample(sample)}
                onUpload={() => fileInputRef.current?.click()}
              />
            )}
          </section>

          <FollowUpPanel
            open={sidePanelOpen}
            lookup={lookup}
            messages={messages}
            loading={followUpLoading}
            onSubmit={handleFollowUp}
            onClose={() => setSidePanelOpen(false)}
          />
        </main>

        <LookupPopup
          lookup={lookup}
          anchor={lookupAnchor}
          onAsk={() => setSidePanelOpen(true)}
          onClose={() => setLookup(undefined)}
          onRetry={retryLookup}
        />
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

type TranscriptProps = {
  cues: SubtitleCue[];
  settings: AppSettings;
  resumeCueId?: string;
  onResumeComplete: () => void;
  onVisibleCueChange: (cueId: string) => void;
  onLookup: (request: LookupRequest, anchor: { x: number; y: number }) => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
};

const Transcript = memo(function Transcript({
  cues,
  settings,
  resumeCueId,
  onResumeComplete,
  onVisibleCueChange,
  onLookup,
  onDebug,
}: TranscriptProps) {
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
        onVisibleCueChange(cueId);
      },
      { threshold: 0.55 },
    );

    root.querySelectorAll<HTMLElement>("[data-cue-id]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [cues, onVisibleCueChange]);

  return (
    <div className="transcript" ref={transcriptRef}>
      {cues.map((cue) => (
        <CueRow key={cue.id} cue={cue} settings={settings} onLookup={onLookup} onDebug={onDebug} />
      ))}
    </div>
  );
});

function getCueDomId(cueId: string) {
  return `cue-row-${cueId}`;
}

const CueRow = memo(function CueRow({
  cue,
  settings,
  onLookup,
  onDebug,
}: {
  cue: SubtitleCue;
  settings: AppSettings;
  onLookup: (request: LookupRequest, anchor: { x: number; y: number }) => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
}) {
  const tokens = useMemo(() => tokenizeCueText(cue.text), [cue.text]);

  function handleSelection() {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const selected = selection?.toString().trim();
      onDebug("selection", "Mouse/touch selection checked", { selected, cueIndex: cue.index });
      if (!selected || selected.length < 2) return;
      if (!selection?.anchorNode || !selection.focusNode) return;

      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
      const rect = range?.getBoundingClientRect();
      onLookup(
        {
          targetText: selected,
          cueText: cue.text,
          cueStartMs: cue.startMs,
          cueEndMs: cue.endMs,
          targetLanguage: settings.targetLanguage,
          model: settings.model,
          mode: "selection",
        },
        rect ? { x: rect.left + rect.width / 2, y: rect.top } : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
    }, 0);
  }

  return (
    <div className="cue-row" id={getCueDomId(cue.id)} data-cue-id={cue.id}>
      <Code
        variant="soft"
        color="gray"
        size="1"
        className="cue-time"
        title={`${formatTimestamp(cue.startMs)} to ${formatTimestamp(cue.endMs)}`}
      >
        {formatTimestamp(cue.startMs)}
      </Code>
      <div className="cue-text" onMouseUp={handleSelection} onTouchEnd={handleSelection}>
        {tokens.map((token, index) =>
          token.kind === "word" ? (
            <span
              className="word-token"
              key={index}
              role="button"
              tabIndex={0}
              title="Click to translate"
              onClick={(event) => {
                const selection = window.getSelection()?.toString().trim();
                onDebug("click", "Word token clicked", {
                  word: token.text,
                  cueIndex: cue.index,
                  selection,
                });
                if (selection) return;
                onLookup(
                  {
                    targetText: token.text,
                    cueText: cue.text,
                    cueStartMs: cue.startMs,
                    cueEndMs: cue.endMs,
                    targetLanguage: settings.targetLanguage,
                    model: settings.model,
                    mode: "word",
                  },
                  { x: event.clientX, y: event.clientY },
                );
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onLookup(
                  {
                    targetText: token.text,
                    cueText: cue.text,
                    cueStartMs: cue.startMs,
                    cueEndMs: cue.endMs,
                    targetLanguage: settings.targetLanguage,
                    model: settings.model,
                    mode: "word",
                  },
                  { x: rect.left + rect.width / 2, y: rect.top },
                );
              }}
            >
              {token.text}
            </span>
          ) : (
            <span key={index}>{token.text}</span>
          ),
        )}
      </div>
    </div>
  );
});

function HomeCatalog({
  hasApiKey,
  loadingSampleSlug,
  sampleStats,
  onOpenSettings,
  onSample,
  onUpload,
}: {
  hasApiKey: boolean;
  loadingSampleSlug: string;
  sampleStats: Record<string, SampleStats>;
  onOpenSettings: () => void;
  onSample: (sample: SampleEpisode) => void;
  onUpload: () => void;
}) {
  return (
    <div className="home-shell">
      <section className="home-intro">
        <div className="home-mark">
          <GraduationCap size={30} />
        </div>
        <Badge color="teal" variant="soft">
          Open-source Dutch study tool
        </Badge>
        <Heading as="h1" size="8" className="home-title">
          Subdiver
        </Heading>
        <Text as="p" size="4" color="gray" className="home-copy">
          Read subtitles as a timed transcript, click any word for contextual translation, or select a phrase
          and ask follow-up questions about grammar and usage.
        </Text>
        <Flex gap="2" wrap="wrap" justify="center">
          <Button size="3" onClick={onUpload}>
            <Upload size={17} />
            Upload subtitles
          </Button>
          <Button size="3" variant="surface" onClick={onOpenSettings}>
            <Settings size={17} />
            {hasApiKey ? "Settings" : "Add API key"}
          </Button>
        </Flex>
      </section>

      <section className="home-band">
        <div className="home-section-heading">
          <Box>
            <Heading as="h2" size="5">
              Start with a sample season
            </Heading>
            <Text color="gray" size="2">
              Educational examples from Zuidas season 1 are bundled so the app works on GitHub Pages.
            </Text>
          </Box>
          {hasApiKey ? (
            <Badge color="green" variant="surface">
              <CheckCircle2 size={13} />
              API key ready
            </Badge>
          ) : (
            <Badge color="amber" variant="surface">
              Add an API key before translating
            </Badge>
          )}
        </div>

        <div className="sample-grid">
          {sampleEpisodes.map((sample) => {
            const stats = sampleStats[sample.slug];
            const loading = loadingSampleSlug === sample.slug;
            return (
              <article className="sample-card" key={sample.slug}>
                <div>
                  <Badge color="gray" variant="soft">
                    S{sample.season} · E{sample.episode}
                  </Badge>
                  <Heading as="h3" size="4" mt="2">
                    {sample.title}
                  </Heading>
                </div>
                <Text size="2" color="gray">
                  {stats ? `${stats.cues} cues · ${stats.duration}` : "Subtitle sample"}
                </Text>
                <Button variant="surface" onClick={() => onSample(sample)} disabled={Boolean(loadingSampleSlug)}>
                  {loading ? <Spinner /> : <Play size={15} />}
                  Start
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-notes">
        <div className="home-note">
          <BookOpen size={18} />
          <Text size="2">
            MIT license covers the Subdiver app code. Bundled subtitle samples remain owned by their
            respective rights holders and are included as learning fixtures.
          </Text>
        </div>
        <div className="home-note">
          <FolderOpen size={18} />
          <Text size="2">
            Your uploaded subtitles, API key, reader position, and lookup cache stay in this browser.
          </Text>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  onChange,
  onClearCache,
  onDebug,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClearCache: () => void;
  onDebug: (scope: string, message: string, data?: unknown) => void;
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
      onDebug("models", "Loading model list");
      const nextModels = await listOpenAiModels(settings.apiKey);
      setModels(nextModels);
      onDebug("models", "Model list loaded", { count: nextModels.length, models: nextModels.slice(0, 20) });
      if (nextModels.length === 0) setModelsError("No compatible text models were returned.");
    } catch (error) {
      onDebug("models", "Model list failed", error instanceof Error ? error.message : String(error));
      setModelsError(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setModelsLoading(false);
    }
  }

  return (
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
  );
}

function LookupPopup({
  lookup,
  anchor,
  onAsk,
  onClose,
  onRetry,
}: {
  lookup?: LookupState;
  anchor: { x: number; y: number };
  onAsk: () => void;
  onClose: () => void;
  onRetry: (request: LookupRequest) => void;
}) {
  if (!lookup) return null;

  const left = Math.min(Math.max(anchor.x, 190), window.innerWidth - 190);
  const top = Math.min(Math.max(anchor.y + 18, 92), window.innerHeight - 180);

  return (
    <div className="lookup-popup" style={{ left, top }}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center" gap="3">
          <Text size="2" weight="bold">
            {lookup.request.targetText}
          </Text>
          <Flex align="center" gap="2">
            {lookup.fromCache ? <Badge color="gray">cached</Badge> : null}
            <IconButton variant="ghost" size="1" onClick={onClose} aria-label="Close lookup">
              <X size={14} />
            </IconButton>
          </Flex>
        </Flex>

        {lookup.loading ? (
          <Flex align="center" gap="2">
            <Spinner />
            <Text size="2" color="gray">
              Translating in context...
            </Text>
          </Flex>
        ) : lookup.error ? (
          <>
            <Callout.Root color="red">
              <Callout.Icon>
                <Info size={16} />
              </Callout.Icon>
              <Callout.Text>{lookup.error}</Callout.Text>
            </Callout.Root>
            <Button variant="soft" onClick={() => onRetry(lookup.request)}>
              Retry lookup
            </Button>
          </>
        ) : lookup.result ? (
          <>
            <Box>
              <Text size="1" color="gray">
                Translation
              </Text>
              <Text as="p" size="4" weight="bold" className="translation-text">
                {lookup.result.translation}
              </Text>
            </Box>
            <Flex gap="2" wrap="wrap">
              {lookup.result.lemma ? <Badge variant="surface">lemma: {lookup.result.lemma}</Badge> : null}
              {lookup.result.partOfSpeech ? <Badge variant="surface">{lookup.result.partOfSpeech}</Badge> : null}
            </Flex>
            {lookup.result.explanation ? (
              <Text size="2" color="gray">
                {lookup.result.explanation}
              </Text>
            ) : null}
            <Button variant="soft" onClick={onAsk}>
              <MessageSquareText size={15} />
              Ask follow-up
            </Button>
          </>
        ) : null}
      </Flex>
    </div>
  );
}

function FollowUpPanel({
  open,
  lookup,
  messages,
  loading,
  onSubmit,
  onClose,
}: {
  open: boolean;
  lookup?: LookupState;
  messages: FollowUpMessage[];
  loading: boolean;
  onSubmit: (question: string) => void;
  onClose: () => void;
}) {
  const canAsk = Boolean(lookup?.request);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Autofocus the textarea whenever the panel opens with a valid lookup.
  useEffect(() => {
    if (!open || !canAsk) return;
    const id = window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }, 200);
    return () => window.clearTimeout(id);
  }, [open, canAsk]);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, loading]);

  function submit() {
    const question = draft.trim();
    if (!question || loading) return;
    setDraft("");
    onSubmit(question);
  }

  const trimmed = draft.trim();
  const canSend = !loading && trimmed.length > 0;

  return (
    <aside className={`side-panel ${open ? "open" : ""}`} aria-hidden={!open}>
      <Flex align="center" justify="between" p="4">
        <Heading as="h2" size="4">
          Follow-up
        </Heading>
        <IconButton variant="ghost" onClick={onClose} aria-label="Close follow-up panel">
          <PanelRightClose size={18} />
        </IconButton>
      </Flex>
      <Separator />

      {canAsk ? (
        <>
          <Box p="4" className="context-card">
            <Text size="1" color="gray">
              Selected
            </Text>
            <Text as="p" weight="bold">
              {lookup?.request.targetText}
            </Text>
            <Text size="1" color="gray">
              Context
            </Text>
            <Text as="p" size="2">
              {lookup?.request.cueText}
            </Text>
          </Box>

          <ScrollArea className="message-scroll" ref={scrollRef}>
            <Flex direction="column" gap="3" p="4">
              {messages.length === 0 ? (
                <Text size="2" color="gray">
                  Ask about grammar, usage, word choice, or a more literal translation.
                </Text>
              ) : null}
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${index}-${message.createdAt}`}>
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
                placeholder="Ask a question. Enter to send, Shift+Enter for a new line."
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <Button className="follow-up-send" disabled={!canSend} onClick={submit}>
                Send
              </Button>
            </div>
          </Box>
        </>
      ) : (
        <Box p="4">
          <Text color="gray" size="2">
            Translate a word or selection first.
          </Text>
        </Box>
      )}
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
