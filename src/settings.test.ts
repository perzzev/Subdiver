import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings, loadSettings, saveSettings } from "./settings";
import { PREVIOUS_TEACHER_GUIDANCE, TEACHER_GUIDANCE } from "./openai";

function mockStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value) });
  return map;
}
afterEach(() => vi.unstubAllGlobals());
it("upgrades a saved old teacher default so existing users receive word-parts guidance", () => {
  const map = mockStorage();
  map.set("subdiver.settings", JSON.stringify({ ...defaultSettings, customPrompt: PREVIOUS_TEACHER_GUIDANCE }));
  expect(loadSettings().customPrompt).toBe(TEACHER_GUIDANCE);
});
it("migrates the old default while preserving language, key and teacher instructions", () => {
  const map = mockStorage();
  map.set("subdiver.settings", JSON.stringify({ ...defaultSettings, model: "gpt-5.5", apiKey: "test-only", targetLanguage: "English", customPrompt: "Explain briefly" }));
  expect(loadSettings()).toMatchObject({ model: "gpt-4.1-mini", apiKey: "test-only", targetLanguage: "English", customPrompt: "Explain briefly" });
});
it("preserves other existing model choices", () => {
  const map = mockStorage();
  map.set("ondertiteling.settings", JSON.stringify({ ...defaultSettings, model: "gpt-4o-mini" }));
  expect(loadSettings().model).toBe("gpt-4o-mini");
});
it("preserves an explicit later choice of the old model and key storage preference", () => {
  const map = mockStorage();
  saveSettings({ ...defaultSettings, model: "gpt-5.5", apiKey: "test-only", persistApiKey: false });
  expect(loadSettings()).toMatchObject({ model: "gpt-5.5", apiKey: "" });
  expect(map.get("subdiver.settings")).not.toContain("test-only");
});
