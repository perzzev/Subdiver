import type { ThemeId } from "./types";

const THEME_KEY = "subdiver.theme";

export const themes: Array<{
  id: ThemeId;
  label: string;
  description: string;
  /** Appearance for Radix Themes provider. */
  appearance: "light" | "dark";
  /** Radix accent color name. */
  accentColor:
    | "indigo"
    | "amber"
    | "grass"
    | "teal";
  grayColor: "sand" | "slate" | "sage";
}> = [
  {
    id: "reader",
    label: "Reader",
    description: "Тихая библиотека — кремовая бумага, засечки, минимум хрома.",
    appearance: "light",
    accentColor: "indigo",
    grayColor: "sand",
  },
  {
    id: "cinema",
    label: "Cinema",
    description: "Кинематографичная подача — тёмный фон, янтарные акценты.",
    appearance: "dark",
    accentColor: "amber",
    grayColor: "slate",
  },
  {
    id: "warm",
    label: "Warm desk",
    description: "Уютный рабочий стол — тёплая палитра, тетрадные линии.",
    appearance: "light",
    accentColor: "grass",
    grayColor: "sand",
  },
];

export function getTheme(id: ThemeId) {
  return themes.find((t) => t.id === id) ?? themes[0];
}

export function loadTheme(): ThemeId {
  const saved = localStorage.getItem(THEME_KEY) as ThemeId | null;
  if (saved && themes.some((t) => t.id === saved)) return saved;
  // Default by prefers-color-scheme.
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "cinema";
  return "reader";
}

export function saveTheme(id: ThemeId) {
  localStorage.setItem(THEME_KEY, id);
}
