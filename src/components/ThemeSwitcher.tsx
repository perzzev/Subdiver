import { DropdownMenu, IconButton } from "@radix-ui/themes";
import { BookOpen, Clapperboard, Coffee } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeId } from "../types";
import { themes } from "../theme";

const ICONS: Record<ThemeId, ReactNode> = {
  reader: <BookOpen size={16} />,
  cinema: <Clapperboard size={16} />,
  warm: <Coffee size={16} />,
};

export function ThemeSwitcher({
  themeId,
  onChange,
}: {
  themeId: ThemeId;
  onChange: (id: ThemeId) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton variant="surface" aria-label="Switch theme" title={`Theme: ${themeId}`}>
          {ICONS[themeId]}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Label>Visual style</DropdownMenu.Label>
        {themes.map((theme) => (
          <DropdownMenu.Item
            key={theme.id}
            onClick={() => onChange(theme.id)}
            data-active={theme.id === themeId ? "" : undefined}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {ICONS[theme.id]} {theme.label}
            </span>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
