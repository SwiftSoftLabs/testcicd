"use client";

import { useAppContext } from "@/context/AppContext";
import { DensityToggleIcon } from "@/components/settings/appearance/DensityToggleIcon";
import { ThemeToggleIcon } from "@/components/settings/appearance/ThemeToggleIcon";
import { TypographyToggleIcon } from "@/components/settings/appearance/TypographyToggleIcon";
import {
  densityLabel,
  nextDensity,
  nextFontSize,
  nextTheme,
  themeLabel,
  typographyLabel,
} from "@/lib/appearance/options";

const ICON_BUTTON_CLASS =
  "flex cursor-pointer items-center justify-center p-2 text-text-secondary transition-colors hover:bg-white/[0.04] hover:text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset";

export function HeaderAppearanceControls() {
  const { appSettings, applyAppearanceSettings } = useAppContext();

  const nextThemeValue = nextTheme(appSettings.theme);
  const nextDensityValue = nextDensity(appSettings.layoutDensity);
  const nextFontSizeValue = nextFontSize(appSettings.fontSize);

  return (
    <div
      className="mr-1 flex shrink-0 items-stretch overflow-hidden rounded-lg border border-border-dark bg-white/5"
      role="group"
      aria-label="Appearance controls"
    >
      <button
        type="button"
        className={ICON_BUTTON_CLASS}
        aria-label={`Theme: ${themeLabel(appSettings.theme)}. Click for ${themeLabel(nextThemeValue)}.`}
        title={`Theme: ${themeLabel(appSettings.theme)}. Click for ${themeLabel(nextThemeValue)}.`}
        onClick={() => applyAppearanceSettings({ theme: nextThemeValue })}
      >
        <ThemeToggleIcon theme={appSettings.theme} className="size-5" />
      </button>

      <button
        type="button"
        className={`${ICON_BUTTON_CLASS} border-x border-border-dark`}
        aria-label={`Density: ${densityLabel(appSettings.layoutDensity)}. Click for ${densityLabel(nextDensityValue)}.`}
        title={`Density: ${densityLabel(appSettings.layoutDensity)}. Click for ${densityLabel(nextDensityValue)}.`}
        onClick={() =>
          applyAppearanceSettings({ layoutDensity: nextDensityValue })
        }
      >
        <DensityToggleIcon
          layoutDensity={appSettings.layoutDensity}
          className="size-5"
        />
      </button>

      <button
        type="button"
        className={ICON_BUTTON_CLASS}
        aria-label={`Typography: ${typographyLabel(appSettings.fontSize)}. Click for ${typographyLabel(nextFontSizeValue)}.`}
        title={`Typography: ${typographyLabel(appSettings.fontSize)}. Click for ${typographyLabel(nextFontSizeValue)}.`}
        onClick={() =>
          applyAppearanceSettings({ fontSize: nextFontSizeValue })
        }
      >
        <TypographyToggleIcon
          fontSize={appSettings.fontSize}
          className="size-5"
        />
      </button>
    </div>
  );
}
