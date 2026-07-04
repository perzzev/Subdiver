import type {
  ChatConversation,
  EpisodeChat,
  LookupResult,
  ReaderProgress,
  TranscriptDocument,
} from "./types";

const DB_NAME = "ondertiteling";
const DB_VERSION = 2;
const TRANSCRIPT_STORE = "transcripts";
const CACHE_STORE = "lookupCache";
const CHAT_STORE = "episodeChats";

const LEGACY_LAST_KEY = "last";
const PROGRESS_MAP_KEY = "subdiver.progressMap";
const LAST_KEY_KEY = "subdiver.lastTranscriptKey";
const LEGACY_PROGRESS_KEY = "subdiver.readerProgress";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) db.createObjectStore(TRANSCRIPT_STORE);
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
        if (!db.objectStoreNames.contains(CHAT_STORE)) db.createObjectStore(CHAT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function getStore(storeName: string, mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/* ------------------------------------------------------------------ *
 * Transcripts (now multi)                                            *
 * ------------------------------------------------------------------ */

export function makeTranscriptKey(doc: TranscriptDocument) {
  if (doc.source?.type === "sample") return `sample:${doc.source.sampleSlug}`;
  return `upload:${doc.fileName}:${doc.rawText.length}:${doc.cues[0]?.startMs ?? 0}:${doc.cues.length}`;
}

export async function saveTranscript(doc: TranscriptDocument) {
  const key = makeTranscriptKey(doc);
  const store = await getStore(TRANSCRIPT_STORE, "readwrite");
  await requestToPromise(store.put(doc, key));
  // Legacy alias for backwards compatibility (also rewrite under "last").
  await requestToPromise(store.put(doc, LEGACY_LAST_KEY));
  localStorage.setItem(LAST_KEY_KEY, key);
}

export async function loadTranscriptByKey(key: string): Promise<TranscriptDocument | undefined> {
  const store = await getStore(TRANSCRIPT_STORE, "readonly");
  return requestToPromise<TranscriptDocument | undefined>(store.get(key));
}

export async function loadLastTranscript(): Promise<TranscriptDocument | undefined> {
  const key = localStorage.getItem(LAST_KEY_KEY);
  if (key) {
    const found = await loadTranscriptByKey(key);
    if (found) return found;
  }
  const store = await getStore(TRANSCRIPT_STORE, "readonly");
  return requestToPromise<TranscriptDocument | undefined>(store.get(LEGACY_LAST_KEY));
}

export async function listSavedTranscriptKeys(): Promise<string[]> {
  const store = await getStore(TRANSCRIPT_STORE, "readonly");
  return new Promise<string[]>((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () =>
      resolve(
        (request.result as IDBValidKey[])
          .filter((key): key is string => typeof key === "string")
          .filter((key) => key !== LEGACY_LAST_KEY),
      );
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTranscriptByKey(key: string) {
  const store = await getStore(TRANSCRIPT_STORE, "readwrite");
  await requestToPromise(store.delete(key));
}

export async function clearAllTranscripts() {
  const store = await getStore(TRANSCRIPT_STORE, "readwrite");
  await requestToPromise(store.clear());
  localStorage.removeItem(LAST_KEY_KEY);
}

export function setLastTranscriptKey(key: string | undefined) {
  if (!key) localStorage.removeItem(LAST_KEY_KEY);
  else localStorage.setItem(LAST_KEY_KEY, key);
}

export function getLastTranscriptKey() {
  return localStorage.getItem(LAST_KEY_KEY) ?? undefined;
}

/* ------------------------------------------------------------------ *
 * Lookup cache (per word/sentence)                                   *
 * ------------------------------------------------------------------ */

export function makeLookupCacheKey(
  model: string,
  targetLanguage: string,
  targetText: string,
  customPrompt = "",
) {
  return [
    model.trim(),
    targetLanguage.trim().toLowerCase(),
    normalizeTarget(targetText),
    customPrompt.trim() ? `cp:${shortHash(customPrompt.trim())}` : "",
    // Bumped when the system prompt template changes so stale answers expire.
    "v2",
  ]
    .filter(Boolean)
    .join("|");
}

function shortHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export async function loadLookup(cacheKey: string): Promise<LookupResult | undefined> {
  const store = await getStore(CACHE_STORE, "readonly");
  return requestToPromise<LookupResult | undefined>(store.get(cacheKey));
}

export async function saveLookup(cacheKey: string, result: LookupResult) {
  const store = await getStore(CACHE_STORE, "readwrite");
  return requestToPromise(store.put(result, cacheKey));
}

export async function deleteLookup(cacheKey: string) {
  const store = await getStore(CACHE_STORE, "readwrite");
  return requestToPromise(store.delete(cacheKey));
}

export async function clearLookupCache() {
  const store = await getStore(CACHE_STORE, "readwrite");
  return requestToPromise(store.clear());
}

/* ------------------------------------------------------------------ *
 * Episode chat — persistent per transcript                           *
 * ------------------------------------------------------------------ */

export async function loadEpisodeChat(transcriptKey: string): Promise<EpisodeChat | undefined> {
  const store = await getStore(CHAT_STORE, "readonly");
  const chat = await requestToPromise<EpisodeChat | undefined>(store.get(transcriptKey));
  if (!chat) return undefined;
  return migrateEpisodeChat(chat);
}

/**
 * Old chats stored a single flat `messages` array. Wrap those into one
 * conversation so history keeps working after the upgrade. Also drops any
 * empty conversations that shouldn't have been persisted.
 */
function migrateEpisodeChat(chat: EpisodeChat): EpisodeChat {
  if (Array.isArray(chat.conversations)) {
    return { ...chat, conversations: chat.conversations.filter((c) => c.messages.length > 0) };
  }

  const legacy = chat.messages ?? [];
  if (legacy.length === 0) {
    return { transcriptKey: chat.transcriptKey, conversations: [], updatedAt: chat.updatedAt };
  }

  const firstUser = legacy.find((m) => m.role === "user");
  const conversation: ChatConversation = {
    id: `${chat.updatedAt}-legacy`,
    createdAt: legacy[0].createdAt,
    updatedAt: legacy[legacy.length - 1].createdAt,
    contextSelection: firstUser?.contextSelection,
    contextCueId: firstUser?.contextCueId,
    contextCueText: firstUser?.contextCueText,
    messages: legacy,
  };
  return { transcriptKey: chat.transcriptKey, conversations: [conversation], updatedAt: chat.updatedAt };
}

export async function saveEpisodeChat(chat: EpisodeChat) {
  const store = await getStore(CHAT_STORE, "readwrite");
  // Never persist the legacy flat list once we've moved to conversations.
  const clean: EpisodeChat = {
    transcriptKey: chat.transcriptKey,
    conversations: chat.conversations,
    updatedAt: chat.updatedAt,
  };
  return requestToPromise(store.put(clean, chat.transcriptKey));
}

export async function clearEpisodeChat(transcriptKey: string) {
  const store = await getStore(CHAT_STORE, "readwrite");
  return requestToPromise(store.delete(transcriptKey));
}

/* ------------------------------------------------------------------ *
 * Reader progress — per transcript, stored in localStorage           *
 * ------------------------------------------------------------------ */

type ProgressMap = Record<string, ReaderProgress>;

function readProgressMap(): ProgressMap {
  // Migrate legacy single-key progress on first read.
  try {
    const raw = localStorage.getItem(PROGRESS_MAP_KEY);
    if (raw) return JSON.parse(raw) as ProgressMap;
  } catch {
    /* fall through */
  }
  const legacy = localStorage.getItem(LEGACY_PROGRESS_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as ReaderProgress;
      if (parsed?.transcriptKey) {
        const map: ProgressMap = { [parsed.transcriptKey]: parsed };
        localStorage.setItem(PROGRESS_MAP_KEY, JSON.stringify(map));
        return map;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function writeProgressMap(map: ProgressMap) {
  localStorage.setItem(PROGRESS_MAP_KEY, JSON.stringify(map));
}

export function loadAllProgress(): ProgressMap {
  return readProgressMap();
}

export function loadReaderProgress(transcriptKey?: string): ReaderProgress | undefined {
  const map = readProgressMap();
  if (transcriptKey) return map[transcriptKey];
  // Fallback: most recently updated entry.
  const entries = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  return entries[0];
}

export function saveReaderProgress(progress: ReaderProgress) {
  const map = readProgressMap();
  map[progress.transcriptKey] = progress;
  writeProgressMap(map);
}

export function clearReaderProgress(transcriptKey?: string) {
  if (!transcriptKey) {
    localStorage.removeItem(PROGRESS_MAP_KEY);
    return;
  }
  const map = readProgressMap();
  delete map[transcriptKey];
  writeProgressMap(map);
}

/* ------------------------------------------------------------------ *
 * Helpers                                                            *
 * ------------------------------------------------------------------ */

function normalizeTarget(targetText: string) {
  return targetText.trim().replace(/\s+/g, " ").toLowerCase();
}

function requestToPromise<T = void>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ------------------------------------------------------------------ *
 * Back-compat re-exports for existing call sites that still import   *
 * the old names. To be removed once App.tsx fully replaces main.tsx. *
 * ------------------------------------------------------------------ */

export const loadTranscript = loadLastTranscript;
export const clearTranscript = clearAllTranscripts;
