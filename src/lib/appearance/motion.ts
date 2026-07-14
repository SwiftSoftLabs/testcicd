/** Shared appearance animation tokens — keep in sync with globals.css `--appearance-*`. */

export const APPEARANCE_DURATION_S = 0.45;

export const APPEARANCE_EASE = [0.22, 1, 0.36, 1] as const;

/** Smooth spring for icon morphs (density tiles, typography glyphs). */
export const APPEARANCE_ICON_SPRING = {
  type: "spring" as const,
  stiffness: 280,
  damping: 32,
  mass: 0.9,
};

/** Fallback tween when reduced motion is preferred. */
export const APPEARANCE_ICON_TWEEN = {
  duration: APPEARANCE_DURATION_S,
  ease: APPEARANCE_EASE,
};
