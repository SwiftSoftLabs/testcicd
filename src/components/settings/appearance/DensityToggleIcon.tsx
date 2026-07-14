"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { DensityType } from "@/context/AppContext";
import {
  APPEARANCE_ICON_SPRING,
  APPEARANCE_ICON_TWEEN,
} from "@/lib/appearance/motion";

const TILE_LAYOUTS: Record<
  DensityType,
  ReadonlyArray<{ x: number; y: number; width: number; height: number; rx: number }>
> = {
  comfortable: [
    { x: 3, y: 3, width: 7, height: 7, rx: 1.5 },
    { x: 14, y: 3, width: 7, height: 7, rx: 1.5 },
    { x: 3, y: 14, width: 7, height: 7, rx: 1.5 },
    { x: 14, y: 14, width: 7, height: 7, rx: 1.5 },
  ],
  compact: [
    { x: 2, y: 2, width: 4.5, height: 4.5, rx: 1 },
    { x: 13, y: 2, width: 4.5, height: 4.5, rx: 1 },
    { x: 2, y: 13, width: 4.5, height: 4.5, rx: 1 },
    { x: 13, y: 13, width: 4.5, height: 4.5, rx: 1 },
  ],
};

interface DensityToggleIconProps {
  layoutDensity: DensityType;
  className?: string;
}

export function DensityToggleIcon({
  layoutDensity,
  className = "size-6 shrink-0",
}: DensityToggleIconProps) {
  const tiles = TILE_LAYOUTS[layoutDensity];
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
      {tiles.map((tile, index) => (
        <motion.rect
          key={index}
          fill="currentColor"
          initial={false}
          animate={{
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height,
            rx: tile.rx,
          }}
          transition={iconTransition}
        />
      ))}
    </motion.svg>
  );
}
