"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import {
  fontSizeDataAttribute,
  normalizeFontSizeStep,
  typographyRootPx,
} from "@/lib/appearance/options";
import { applyThemeClass, resolveThemeForPath } from "@/lib/theme";

const ThemeHandler: React.FC = () => {
  const { appSettings } = useAppContext();
  const pathname = usePathname();

  useEffect(() => {
    const html = document.documentElement;

    applyThemeClass(
      html,
      resolveThemeForPath(appSettings.theme, pathname ?? undefined),
    );

    if (appSettings.layoutDensity === "compact") {
      html.classList.add("density-compact");
    } else {
      html.classList.remove("density-compact");
    }

    const fontStep = normalizeFontSizeStep(appSettings.fontSize);
    const rootPx = typographyRootPx(appSettings.fontSize);

    /* Single rem root: typography scales text/layout; density scales via --density-scale spacing token. */
    html.style.fontSize = `${rootPx}px`;
    html.style.setProperty("--base-font-size", `${rootPx}px`);
    html.dataset.density = appSettings.layoutDensity;
    html.dataset.fontSize = fontSizeDataAttribute(fontStep);
  }, [
    appSettings.theme,
    appSettings.layoutDensity,
    appSettings.fontSize,
    pathname,
  ]);

  return null;
};

export default ThemeHandler;
