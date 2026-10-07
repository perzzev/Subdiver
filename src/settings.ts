import { PREVIOUS_TEACHER_GUIDANCE, TEACHER_GUIDANCE } from "./openai";
import type { AppSettings } from "./types";

const SETTINGS_KEY = "subdiver.settings";
const LEGACY_SETTINGS_KEY = "ondertiteling.settings";

export const defaultSettings: AppSettings = {
  apiKey: "",
  targetLanguage: "Russian",
  model: "gpt-4.1-mini",
  persistApiKey: true,
  customPrompt: TEACHER_GUIDANCE,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const saved = JSON.parse(raw) as Partial<AppSettings> & { modelDefaultsVersion?: number };
    const merged = { ...defaultSettings, ...saved } as AppSettings;
    // Upgrade the old expensive default once. A later explicit model choice,
    // including GPT-5.5, is preserved by saveSettings's version marker.
    if (!saved.modelDefaultsVersion && merged.model === "gpt-5.5") {
      merged.model = defaultSettings.model;
    }
    // Refresh an unchanged old default as well as an empty prompt. Preserve
    // personal teacher instructions; word lookups add the memory aid separately.
    if (typeof merged.customPrompt !== "string" || merged.customPrompt.trim().length === 0 ||
      merged.customPrompt.trim() === PREVIOUS_TEACHER_GUIDANCE) {
      merged.customPrompt = TEACHER_GUIDANCE;
    }
    return merged;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  const stored = settings.persistApiKey ? settings : { ...settings, apiKey: "" };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...stored, modelDefaultsVersion: 1 }));
}
