"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  APPEARANCE_ICON_SPRING,
  APPEARANCE_ICON_TWEEN,
} from "@/lib/appearance/motion";
import {
  normalizeFontSizeStep,
  type FontSizeStep,
} from "@/lib/appearance/options";

const TYPOGRAPHY_LAYOUTS: Record<
  FontSizeStep,
  {
    capA: { x: number; y: number; fontSize: number; textAnchor: "middle" | "start" };
    lowerA: { x: number; y: number; fontSize: number; opacity: number };
    bars: ReadonlyArray<{
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
    }>;
  }
> = {
  0: {
    capA: { x: 12, y: 10, fontSize: 7, textAnchor: "middle" },
    lowerA: { x: 15.5, y: 11, fontSize: 6.5, opacity: 0 },
    bars: [
      { x: 5, y: 14, width: 14, height: 1.5, rx: 0.75 },
      { x: 7, y: 17, width: 10, height: 1.5, rx: 0.75 },
      { x: 9, y: 20, width: 6, height: 1.5, rx: 0.75 },
    ],
  },
  50: {
    capA: { x: 8.5, y: 11, fontSize: 8.5, textAnchor: "start" },
    lowerA: { x: 15.5, y: 11, fontSize: 6.5, opacity: 1 },
    bars: [
      { x: 5, y: 14.5, width: 14, height: 2, rx: 1 },
      { x: 5, y: 17.5, width: 14, height: 2, rx: 1 },
      { x: 5, y: 20.5, width: 14, height: 2, rx: 1 },
    ],
  },
  100: {
    capA: { x: 12, y: 12, fontSize: 11, textAnchor: "middle" },
    lowerA: { x: 15.5, y: 11, fontSize: 6.5, opacity: 0 },
    bars: [
      { x: 4, y: 15, width: 16, height: 2, rx: 1 },
      { x: 4, y: 18, width: 16, height: 2, rx: 1 },
      { x: 4, y: 21, width: 16, height: 2, rx: 1 },
    ],
  },
};

interface TypographyToggleIconProps {
  fontSize: number;
  className?: string;
}

export function TypographyToggleIcon({
  fontSize,
  className = "size-6 shrink-0 overflow-visible",
}: TypographyToggleIconProps) {
  const step = normalizeFontSizeStep(fontSize);
  const layout = TYPOGRAPHY_LAYOUTS[step];
  const reduceMotion = useReducedMotion();
  const iconTransition = reduceMotion ? APPEARANCE_ICON_TWEEN : APPEARANCE_ICON_SPRING;

  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      whileTap={{ scale: [1, 0.92, 1] }}
      transition={{ duration: 0.2 }}
    >
      <motion.text
        fill="currentColor"
        fontWeight="700"
        fontFamily="var(--font-sans, Inter, sans-serif)"
        textAnchor={layout.capA.textAnchor}
        initial={false}
        animate={{
          x: layout.capA.x,
          y: layout.capA.y,
          fontSize: layout.capA.fontSize,
        }}
        transition={iconTransition}
      >
        A
      </motion.text>
      <motion.text
        fill="currentColor"
        fontWeight="700"
        fontFamily="var(--font-sans, Inter, sans-serif)"
        initial={false}
        animate={{
          x: layout.lowerA.x,
          y: layout.lowerA.y,
          fontSize: layout.lowerA.fontSize,
          opacity: layout.lowerA.opacity,
        }}
        transition={iconTransition}
      >
        a
      </motion.text>
      {layout.bars.map((bar, index) => (
        <motion.rect
          key={index}
          fill="currentColor"
          initial={false}
          animate={{
            x: bar.x,
            y: bar.y,
            width: bar.width,
            height: bar.height,
            rx: bar.rx,
          }}
          transition={iconTransition}
        />
      ))}
    </motion.svg>
  );
}
