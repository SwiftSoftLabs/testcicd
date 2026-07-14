"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ThemeType } from "@/context/AppContext";

const ICON_TRANSITION = { duration: 0.2, ease: "easeOut" as const };

interface ThemeToggleIconProps {
  theme: ThemeType;
  className?: string;
}

export function ThemeToggleIcon({
  theme,
  className = "size-6 shrink-0",
}: ThemeToggleIconProps) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      whileTap={{ rotate: [0, 12, 0] }}
      transition={{ duration: 0.25 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {theme === "dark" && (
          <motion.g
            key="dark"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={ICON_TRANSITION}
          >
            <path
              fill="currentColor"
              d="M12 3a1 1 0 0 1 1 1v1.06A7 7 0 0 1 18.94 11H20a1 1 0 1 1 0 2h-1.06A7 7 0 0 1 13 18.94V20a1 1 0 1 1-2 0v-1.06A7 7 0 0 1 5.06 13H4a1 1 0 0 1 0-2h1.06A7 7 0 0 1 11 5.06V4a1 1 0 0 1 1-1Zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"
            />
          </motion.g>
        )}
        {theme === "light" && (
          <motion.g
            key="light"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={ICON_TRANSITION}
          >
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path
              fill="currentColor"
              d="M12 2a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17.5a1 1 0 0 1 1 1V22a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1ZM4.22 4.22a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 0 1-1.42 1.42L4.22 5.64a1 1 0 0 1 0-1.42Zm15.1 15.1a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 1 1-1.42 1.42l-1.06-1.06a1 1 0 0 1 0-1.42ZM2 12a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm17.5 0a1 1 0 0 1 1-1H22a1 1 0 1 1 0 2h-1.5a1 1 0 0 1-1-1ZM4.22 19.78a1 1 0 0 1 0-1.42l1.06-1.06a1 1 0 1 1 1.42 1.42l-1.06 1.06a1 1 0 0 1-1.42 0Zm15.1-15.1a1 1 0 0 1 0-1.42l1.06-1.06a1 1 0 1 1 1.42 1.42l-1.06 1.06a1 1 0 0 1-1.42 0Z"
            />
          </motion.g>
        )}
        {theme === "system" && (
          <motion.g
            key="system"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={ICON_TRANSITION}
          >
            <rect
              x="4"
              y="5"
              width="16"
              height="11"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              fill="currentColor"
              d="M8 18h8a1 1 0 0 1 1 1v.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V19a1 1 0 0 1 1-1Z"
            />
            <circle cx="12" cy="10.5" r="2.5" fill="currentColor" />
          </motion.g>
        )}
      </AnimatePresence>
    </motion.svg>
  );
}
