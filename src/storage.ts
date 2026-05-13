import type { LookupResult, ReaderProgress, TranscriptDocument } from "./types";

const DB_NAME = "ondertiteling";
const DB_VERSION = 1;
const TRANSCRIPT_STORE = "transcripts";
const CACHE_STORE = "lookupCache";
const LAST_TRANSCRIPT_KEY = "last";
const PROGRESS_KEY = "subdiver.readerProgress";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TRANSCRIPT_STORE)) db.createObjectStore(TRANSCRIPT_STORE);
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
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

export async function saveTranscript(doc: TranscriptDocument) {
  const store = await getStore(TRANSCRIPT_STORE, "readwrite");
  return requestToPromise(store.put(doc, LAST_TRANSCRIPT_KEY));
}

export async function loadTranscript(): Promise<TranscriptDocument | undefined> {
  const store = await getStore(TRANSCRIPT_STORE, "readonly");
  return requestToPromise<TranscriptDocument | undefined>(store.get(LAST_TRANSCRIPT_KEY));
}

export async function clearTranscript() {
  const store = await getStore(TRANSCRIPT_STORE, "readwrite");
  return requestToPromise(store.delete(LAST_TRANSCRIPT_KEY));
}

export function makeLookupCacheKey(model: string, targetLanguage: string, targetText: string) {
  return `${model.trim()}|${targetLanguage.trim().toLowerCase()}|${normalizeTarget(targetText)}|v1`;
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

export function makeTranscriptKey(doc: TranscriptDocument) {
  if (doc.source?.type === "sample") return `sample:${doc.source.sampleSlug}`;
  return `upload:${doc.fileName}:${doc.rawText.length}:${doc.cues[0]?.startMs ?? 0}:${doc.cues.length}`;
}

export function loadReaderProgress(): ReaderProgress | undefined {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as ReaderProgress;
  } catch {
    return undefined;
  }
}

export function saveReaderProgress(progress: ReaderProgress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function clearReaderProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

function normalizeTarget(targetText: string) {
  return targetText.trim().replace(/\s+/g, " ").toLowerCase();
}

function requestToPromise<T = void>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
