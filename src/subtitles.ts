import type { SubtitleCue } from "./types";

export function parseSubtitleFile(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "");
  const cues: SubtitleCue[] = [];

  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    if (lines.length === 0) continue;
    if (lines[0].startsWith("WEBVTT") || lines[0].startsWith("NOTE") || lines[0].startsWith("STYLE")) {
      continue;
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const timing = parseTimingLine(lines[timingIndex]);
    if (!timing) continue;

    const rawText = lines.slice(timingIndex + 1).join("\n");
    if (!rawText.trim()) continue;

    const text = normalizeCueText(rawText);
    cues.push({
      id: `${timing.startMs}-${timing.endMs}-${cues.length}`,
      index: cues.length + 1,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text,
      rawText,
    });
  }

  if (cues.length === 0) {
    throw new Error("No subtitle cues found. Only VTT and SRT files are supported.");
  }

  return cues;
}

export function normalizeCueText(text: string) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\.*?\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimingLine(line: string) {
  const [startRaw, endRaw] = line.split("-->");
  if (!startRaw || !endRaw) return undefined;

  const startMs = parseTimestamp(startRaw.trim());
  const endMs = parseTimestamp(endRaw.trim().split(/\s+/)[0]);
  if (startMs === undefined || endMs === undefined) return undefined;

  return { startMs, endMs };
}

function parseTimestamp(value: string) {
  const match = value.match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return undefined;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4].padEnd(3, "0").slice(0, 3);

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction);
}

export function formatTimestamp(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
  }

  return `${minutes}:${pad(seconds)}.${pad(centiseconds)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getWordAtPoint(text: string, offset: number) {
  const isWordChar = (char: string) => /[\p{L}\p{M}'’-]/u.test(char);
  let start = offset;
  let end = offset;

  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;

  const word = text.slice(start, end).trim();
  return word || "";
}

export function tokenizeCueText(text: string): Array<{ kind: "word" | "text"; text: string }> {
  const tokens: Array<{ kind: "word" | "text"; text: string }> = [];
  const wordPattern = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(text))) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: "word", text: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}
