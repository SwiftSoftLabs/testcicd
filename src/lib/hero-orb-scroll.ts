import { gsap } from "gsap";

/** Scroll-driven orb motion — tuned for subtle, natural movement */
export const HERO_ORB_SCROLL = {
  /** Max downward drift (px) through the hero */
  maxTravelY: 88,
  /** Max ring spin on Z from scroll (~22°) */
  maxRotZ: 0.38,
  /** Max forward tilt on X from scroll (~6°) */
  maxRotX: 0.1,
  /** Idle Z spin speed (rad/s) — slow ambient turn */
  idleRotZ: 0.16,
  /** Fraction of hero height that maps progress 0→1 */
  progressRangeRatio: 1,
} as const;

/**
 * 0 at top of hero, 1 after scrolling through the full hero section.
 * Computed from layout each frame so Lenis smooth scroll stays in sync.
 */
export function getHeroOrbScrollProgress(): number {
  if (typeof document === "undefined") return 0;
  const hero = document.getElementById("hero-section");
  if (!hero) return 0;

  const rect = hero.getBoundingClientRect();
  const range = hero.offsetHeight * HERO_ORB_SCROLL.progressRangeRatio;
  if (range <= 0) return 0;

  // Layout delta (Lenis / native scroll) + scrollY fallback
  const fromRect = Math.max(0, -rect.top);
  const heroDocTop = rect.top + window.scrollY;
  const fromScrollY = Math.max(0, window.scrollY - heroDocTop);
  const scrolled = Math.max(fromRect, fromScrollY);

  const linear = Math.min(1, scrolled / range);
  return gsap.utils.clamp(0, 1, gsap.parseEase("sine.inOut")(linear));
}

/** Apply scroll-driven transform to the logo slot (px + degrees). */
export function getHeroOrbSlotMotion(scrollProgress: number, timeSec: number) {
  const sp = scrollProgress;
  const t = timeSec;
  const wander = 1 - sp * 0.65;
  const R_x = 10;
  const R_y = 8;

  return {
    x: R_x * Math.sin(2 * t) * wander,
    y: R_y * Math.sin(t) * wander + sp * HERO_ORB_SCROLL.maxTravelY,
    rotation:
      (sp * HERO_ORB_SCROLL.maxRotZ * 180) / Math.PI +
      ((t * HERO_ORB_SCROLL.idleRotZ * 180) / Math.PI) % 360,
  };
}
