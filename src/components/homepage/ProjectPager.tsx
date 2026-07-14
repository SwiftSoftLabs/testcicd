"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

interface PageSection {
  id: string;
  name: string;
}

interface ProjectPagerProps {
  sections: PageSection[];
  currentIndex: number;
  visible: boolean;
  onStep?: (direction: -1 | 1) => void;
}

export default function ProjectPager({
  sections,
  currentIndex,
  visible,
  onStep,
}: ProjectPagerProps) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!nameRef.current) return;
      gsap.fromTo(
        nameRef.current,
        { opacity: 0, y: 5 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
      );
    },
    { dependencies: [currentIndex], scope: containerRef },
  );

  const current = sections[currentIndex];

  return (
    <div
      ref={containerRef}
      className={`nav-pill fixed z-50 hidden md:flex items-center gap-1 px-2 py-1.5 transition-all duration-400
                        ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      style={{ top: "88px", right: "24px" }}
      aria-label="Page section indicator"
      aria-live="polite"
    >
      {/* Prev arrow */}
      <button
        onClick={() => onStep?.(-1)}
        disabled={currentIndex === 0}
        aria-label="Previous section"
        className="cursor-pointer font-terminal text-[10px] text-white/40 hover:text-white disabled:text-white/10 transition-colors px-1.5"
      >
        «
      </button>

      <span
        ref={nameRef}
        className="font-display font-semibold text-[11px] uppercase tracking-widest text-white/70 min-w-[120px] text-center"
      >
        {current ? `${currentIndex + 1}. ${current.name}` : ""}
      </span>

      {/* Next arrow */}
      <button
        onClick={() => onStep?.(1)}
        disabled={currentIndex === sections.length - 1}
        aria-label="Next section"
        className="cursor-pointer font-terminal text-[10px] text-white/40 hover:text-white disabled:text-white/10 transition-colors px-1.5"
      >
        »
      </button>
    </div>
  );
}
