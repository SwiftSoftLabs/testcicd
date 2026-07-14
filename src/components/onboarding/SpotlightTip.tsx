"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SpotlightTipProps {
  targets: string[];
  /** Shown when spotlighting a button/link (with backdrop) */
  overlayTitle: string;
  overlayDescription: string;
  /** Shown when spotlighting an input field (no backdrop) */
  guideTitle: string;
  guideDescription: string;
  step: number;
  totalSteps: number;
  actionLabel?: string;
  onAction?: () => void;
  skipLabel?: string;
  onSkip?: () => void;
}

const RING_PAD = 8; // padding around the highlight ring
const TIP_W = 300; // tooltip card width in px
const TIP_H = 150; // estimated tooltip height for space calculation

function isInputLike(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Position tooltip adjacent to the target element.
 * preferSide=false (buttons): below → above → right → left
 * preferSide=true  (inputs):  right → left → below → above
 * Inputs sit between other fields, so side placement avoids overlapping them.
 */
function calcTooltipStyle(
  rect: Rect,
  preferSide: boolean,
): React.CSSProperties {
  const GAP = 12;
  const VIEWPORT_PAD = 12;
  const spaceBelow =
    window.innerHeight - (rect.top + rect.height + RING_PAD) - GAP;
  const spaceAbove = rect.top - RING_PAD - GAP;
  const spaceRight =
    window.innerWidth - (rect.left + rect.width + RING_PAD) - GAP;
  const spaceLeft = rect.left - RING_PAD - GAP;

  const clampH = (l: number) =>
    Math.max(
      VIEWPORT_PAD,
      Math.min(l, window.innerWidth - TIP_W - VIEWPORT_PAD),
    );
  const clampV = (t: number) =>
    Math.max(
      VIEWPORT_PAD,
      Math.min(t, window.innerHeight - TIP_H - VIEWPORT_PAD),
    );
  const hCenter = clampH(rect.left + rect.width / 2 - TIP_W / 2);
  const vCenter = clampV(rect.top + rect.height / 2 - TIP_H / 2);

  const below = (): React.CSSProperties => ({
    position: "fixed",
    top: rect.top + rect.height + RING_PAD + GAP,
    left: hCenter,
    width: TIP_W,
  });
  const above = (): React.CSSProperties => ({
    position: "fixed",
    top: rect.top - RING_PAD - GAP - TIP_H,
    left: hCenter,
    width: TIP_W,
  });
  const right = (): React.CSSProperties => ({
    position: "fixed",
    top: vCenter,
    left: rect.left + rect.width + RING_PAD + GAP,
    width: TIP_W,
  });
  const left = (): React.CSSProperties => ({
    position: "fixed",
    top: vCenter,
    left: rect.left - RING_PAD - GAP - TIP_W,
    width: TIP_W,
  });
  const fallback = (): React.CSSProperties => {
    const targetIsLarge =
      rect.width >= window.innerWidth * 0.75 ||
      rect.height >= window.innerHeight * 0.75;

    if (targetIsLarge) {
      return {
        position: "fixed",
        top: clampV(window.innerHeight - TIP_H - VIEWPORT_PAD),
        left: clampH(window.innerWidth - TIP_W - VIEWPORT_PAD),
        width: TIP_W,
      };
    }

    return {
      position: "fixed",
      top: clampV(rect.top + rect.height + RING_PAD + GAP),
      left: hCenter,
      width: TIP_W,
    };
  };

  if (!preferSide) {
    // Buttons: prefer vertical (below is standard tooltip placement)
    if (spaceBelow >= TIP_H) return below();
    if (spaceAbove >= TIP_H) return above();
    if (spaceRight >= TIP_W) return right();
    if (spaceLeft >= TIP_W) return left();
    return fallback();
  } else {
    // Inputs: prefer side to avoid overlapping adjacent form fields
    if (spaceRight >= TIP_W) return right();
    if (spaceLeft >= TIP_W) return left();
    if (spaceAbove >= TIP_H) return above();
    if (spaceBelow >= TIP_H) return below();
    return fallback();
  }
}

const SpotlightTip: React.FC<SpotlightTipProps> = ({
  targets,
  overlayTitle,
  overlayDescription,
  guideTitle,
  guideDescription,
  step,
  totalSteps,
  actionLabel,
  onAction,
  onSkip,
  skipLabel,
}) => {
  const [rect, setRect] = useState<Rect | null>(null);
  const [guideMode, setGuideMode] = useState(false);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const hasScrolledRef = useRef(false);
  const targetsKey = targets.join(",");

  // Reset scroll flag when the target set changes (tour advances to a new step)
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [targetsKey]);

  const findAndMeasure = useCallback(() => {
    // Restore previous target
    if (activeTargetRef.current) {
      activeTargetRef.current.style.position = "";
      activeTargetRef.current.style.zIndex = "";
    }

    let el: HTMLElement | null = null;
    for (const t of targets) {
      el = document.querySelector(`[data-tour="${t}"]`) as HTMLElement | null;
      if (el) break;
    }

    if (!el) {
      activeTargetRef.current = null;
      setRect(null);
      return;
    }

    // Scroll into view the first time a new target is found
    if (el !== activeTargetRef.current && !hasScrolledRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      hasScrolledRef.current = true;
    }

    activeTargetRef.current = el;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });

    const input = isInputLike(el);
    setGuideMode(input);

    if (!input) {
      // Lift button above backdrop so it remains clickable
      el.style.position = "relative";
      el.style.zIndex = "902";
    }
  }, [targets]);

  useEffect(() => {
    findAndMeasure();

    const ro = new ResizeObserver(findAndMeasure);
    ro.observe(document.documentElement);
    window.addEventListener("resize", findAndMeasure);
    // capture:true catches scroll from any inner scrollable container, not just window
    window.addEventListener("scroll", findAndMeasure, {
      capture: true,
      passive: true,
    });

    // Re-scan when modals / pages appear — debounced to avoid firing on every
    // React reconciliation tick (childList+subtree fires very frequently).
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver(() => {
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(findAndMeasure, 100);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (mutationTimer) clearTimeout(mutationTimer);
      if (activeTargetRef.current) {
        activeTargetRef.current.style.position = "";
        activeTargetRef.current.style.zIndex = "";
      }
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", findAndMeasure);
      window.removeEventListener("scroll", findAndMeasure, { capture: true });
    };
  }, [findAndMeasure]);

  const title = guideMode ? guideTitle : overlayTitle;
  const description = guideMode ? guideDescription : overlayDescription;
  const tipStyle = rect
    ? calcTooltipStyle(rect, guideMode)
    : { display: "none" };

  return (
    <>
      {/* Backdrop — only for buttons/links when the target element exists */}
      {!guideMode && rect && (
        <div className="fixed inset-0 bg-black/60 pointer-events-none z-[900]" />
      )}

      {/* Highlight ring */}
      {rect && (
        <div
          className="fixed pointer-events-none z-[901] rounded-xl border-2 border-primary transition-all duration-300"
          style={{
            top: rect.top - RING_PAD,
            left: rect.left - RING_PAD,
            width: rect.width + RING_PAD * 2,
            height: rect.height + RING_PAD * 2,
            boxShadow:
              "0 0 0 4px rgba(25,93,230,0.25), 0 0 20px rgba(25,93,230,0.3)",
          }}
        />
      )}

      {/* Tooltip — adjacent to target in both modes */}
      <div
        className="z-[902] bg-surface-dark border border-border-dark rounded-2xl shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
        style={tipStyle}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
            Step {step} of {totalSteps}
          </span>
          {onSkip && (
            <button
              onClick={onSkip}
              className="cursor-pointer text-[10px] text-text-secondary hover:text-white transition-colors"
            >
              {skipLabel ?? "Skip tour"}
            </button>
          )}
        </div>

        <div>
          <p className="text-white font-bold text-sm">{title}</p>
          <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>

        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="cursor-pointer w-full py-2 bg-primary text-white font-black text-xs uppercase tracking-widest rounded-lg hover:bg-blue-600 transition-all active:scale-95"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </>
  );
};

export default SpotlightTip;
