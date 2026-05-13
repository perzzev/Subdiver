import { TEACHER_GUIDANCE } from "./openai";
import type { AppSettings } from "./types";

const SETTINGS_KEY = "subdiver.settings";
const LEGACY_SETTINGS_KEY = "ondertiteling.settings";

export const defaultSettings: AppSettings = {
  apiKey: "",
  targetLanguage: "Russian",
  model: "gpt-5.5",
  persistApiKey: true,
  customPrompt: TEACHER_GUIDANCE,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const merged = { ...defaultSettings, ...JSON.parse(raw) } as AppSettings;
    // Backfill empty teacher instructions for users who upgraded from the
    // version that had an empty default — we want to show them what's in
    // the field so they can edit it.
    if (typeof merged.customPrompt !== "string" || merged.customPrompt.trim().length === 0) {
      merged.customPrompt = TEACHER_GUIDANCE;
    }
    return merged;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  const stored = settings.persistApiKey ? settings : { ...settings, apiKey: "" };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
}
