import type { DensityType, ThemeType } from "@/context/AppContext";

export const FONT_SIZE_STEPS = [0, 50, 100] as const;
export type FontSizeStep = (typeof FONT_SIZE_STEPS)[number];

const THEME_ORDER: ThemeType[] = ["dark", "light", "system"];
const FONT_SIZE_ORDER = FONT_SIZE_STEPS;

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeType;
  label: string;
  icon: string;
}> = [
  { value: "light", label: "Light Mode", icon: "light_mode" },
  { value: "dark", label: "Dark Mode", icon: "dark_mode" },
  { value: "system", label: "System Sync", icon: "settings_brightness" },
];

export const DENSITY_OPTIONS: ReadonlyArray<{
  value: DensityType;
  label: string;
  icon: string;
}> = [
  { value: "comfortable", label: "Comfortable", icon: "grid_view" },
  { value: "compact", label: "Compact", icon: "view_comfy" },
];

/** Exactly three typography steps — not the legacy 0–100 slider positions. */
export const TYPOGRAPHY_OPTIONS: ReadonlyArray<{
  value: FontSizeStep;
  label: string;
}> = [
  { value: 0, label: "Small" },
  { value: 50, label: "Default" },
  { value: 100, label: "Large" },
];

export function themeLabel(theme: ThemeType): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function densityLabel(density: DensityType): string {
  return (
    DENSITY_OPTIONS.find((option) => option.value === density)?.label ??
    density
  );
}

export function typographyLabel(fontSize: number): string {
  const step = normalizeFontSizeStep(fontSize);
  return (
    TYPOGRAPHY_OPTIONS.find((option) => option.value === step)?.label ??
    "Default"
  );
}

export function normalizeFontSizeStep(value: number): FontSizeStep {
  if (value <= 25) return 0;
  if (value <= 75) return 50;
  return 100;
}

export type FontSizeDataAttr = "small" | "default" | "large";

export function fontSizeDataAttribute(step: FontSizeStep): FontSizeDataAttr {
  if (step === 0) return "small";
  if (step === 100) return "large";
  return "default";
}

export function typographyRootPx(fontSize: number): number {
  const step = normalizeFontSizeStep(fontSize);
  return 12 + (step / 100) * 8;
}

export function nextTheme(current: ThemeType): ThemeType {
  const index = THEME_ORDER.indexOf(current);
  const nextIndex = index === -1 ? 0 : (index + 1) % THEME_ORDER.length;
  return THEME_ORDER[nextIndex];
}

export function nextDensity(current: DensityType): DensityType {
  return current === "compact" ? "comfortable" : "compact";
}

export function nextFontSize(current: number): FontSizeStep {
  const step = normalizeFontSizeStep(current);
  const index = FONT_SIZE_ORDER.indexOf(step);
  const nextIndex = index === -1 ? 0 : (index + 1) % FONT_SIZE_ORDER.length;
  return FONT_SIZE_ORDER[nextIndex];
}
