import type { AppSettings } from "./types";

const SETTINGS_KEY = "subdiver.settings";
const LEGACY_SETTINGS_KEY = "ondertiteling.settings";

export const defaultSettings: AppSettings = {
  apiKey: "",
  targetLanguage: "Russian",
  model: "gpt-4.1-mini",
  persistApiKey: true,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  const stored = settings.persistApiKey ? settings : { ...settings, apiKey: "" };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
}
