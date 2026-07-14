"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import type Lenis from "lenis";

interface NavPillProps {
  lenisRef: React.RefObject<Lenis | null>;
  onWorkClick: () => void;
  onPricingClick: () => void;
  onContactClick: () => void;
}

export default function NavPill({
  lenisRef,
  onWorkClick,
  onPricingClick,
  onContactClick,
}: NavPillProps) {
  const pillRef = useRef<HTMLDivElement>(null);
  const svgPathRef = useRef<SVGPathElement>(null);

  // Animate sine-wave divider — amplitude responds to scroll velocity
  useEffect(() => {
    let phase = 0;
    const WIDTH = 48;
    const BASE_AMPLITUDE = 3;
    const FREQUENCY = 0.32;
    const OMEGA = 1.2;

    function tick(_time: number, deltaTime: number) {
      if (!svgPathRef.current) return;
      phase += OMEGA * (deltaTime / 1000);

      // Get scroll velocity for amplitude modulation
      const velocity = lenisRef.current?.velocity ?? 0;
      const amplitude = BASE_AMPLITUDE + Math.min(Math.abs(velocity) * 0.5, 4);

      const points: string[] = [];
      for (let x = 0; x <= WIDTH; x += 2) {
        const y = 8 + amplitude * Math.sin(FREQUENCY * x + phase);
        points.push(x === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
      }
      svgPathRef.current.setAttribute("d", points.join(" "));
    }

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [lenisRef]);

  // Hover glow
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;

    function onEnter() {
      gsap.to(pill, {
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 32px rgba(59,130,246,0.15), 0 0 0 1px rgba(59,130,246,0.12)",
        borderColor: "rgba(59,130,246,0.4)",
        duration: 0.3,
        ease: "power2.out",
      });
    }
    function onLeave() {
      gsap.to(pill, {
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(59,130,246,0.1)",
        borderColor: "rgba(59,130,246,0.25)",
        duration: 0.4,
        ease: "power2.out",
      });
    }

    pill.addEventListener("mouseenter", onEnter);
    pill.addEventListener("mouseleave", onLeave);
    return () => {
      pill.removeEventListener("mouseenter", onEnter);
      pill.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div className="fixed top-[max(1.25rem,env(safe-area-inset-top,0px))] right-4 sm:right-6 z-50 flex items-center gap-4 sm:gap-5">
      <Link
        href="/login"
        className="font-terminal text-[11px] tracking-wide text-white/50 hover:text-white/90 transition-colors shrink-0"
      >
        Sign in
      </Link>

      <div ref={pillRef} className="nav-pill hidden md:flex items-center px-1">
      <button
        onClick={onWorkClick}
        aria-label="Jump to Work section"
        className="cursor-pointer font-display font-bold text-[11px] uppercase tracking-[0.2em] text-white/70 hover:text-white transition-colors px-3 py-2.5"
      >
        WORK
      </button>

      <button
        onClick={onPricingClick}
        aria-label="Jump to Pricing section"
        className="cursor-pointer font-display font-bold text-[11px] uppercase tracking-[0.2em] text-white/70 hover:text-white transition-colors px-3 py-2.5"
      >
        PRICING
      </button>

      <svg
        width="48"
        height="16"
        viewBox="0 0 48 16"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          ref={svgPathRef}
          stroke="rgba(59,130,246,0.45)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <button
        onClick={onContactClick}
        aria-label="Jump to Contact section"
        className="cursor-pointer font-display font-bold text-[11px] uppercase tracking-[0.2em] text-white/70 hover:text-white transition-colors px-3 py-2.5"
      >
        CONTACT
      </button>
      </div>
    </div>
  );
}
