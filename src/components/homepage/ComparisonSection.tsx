"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { HERO_ORB_SCROLL } from "@/lib/hero-orb-scroll";

const IridescentOrb = dynamic(() => import("./IridescentOrb"), { ssr: false });

/** Slower 2D spin than hero — matches hero orb slot rotation feel */
const AMBIENT_SLOT_ROT_SPEED = HERO_ORB_SCROLL.idleRotZ * 0.55;

gsap.registerPlugin(ScrollTrigger);

const ROWS = [
  {
    category: "Project Management",
    old: "Project Tracker · $14/user · No comms context",
    ow: "Sprint Engine + burndowns built in",
  },
  {
    category: "Team Messaging",
    old: "Messaging Platform · $7/user · Disconnected from tasks",
    ow: "Threaded chat linked to tasks & PRs",
  },
  {
    category: "File Storage",
    old: "Cloud Storage · $12/user · No version control",
    ow: "Git-style file versioning + AI search",
  },
  {
    category: "Code Reviews",
    old: "Code Host · $19/user · Isolated from project context",
    ow: "PR reviews inside your workspace",
  },
  {
    category: "Email",
    old: "Email Client · $6/user · Siloed from everything else",
    ow: "Unified inbox, AI-triaged, linked to tasks",
  },
  {
    category: "Analytics",
    old: "Analytics Tool · $25/user · Only engineers can use it",
    ow: "Team velocity + burndowns for everyone",
  },
];

export default function ComparisonSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const orbSpinRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(
        ".comparison-orb-wrap",
        { opacity: 0 },
        {
          opacity: 1,
          duration: 1.4,
          ease: "power2.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
          },
        },
      );

      gsap.fromTo(
        ".comparison-orb-reveal",
        { scale: 0.88, filter: "blur(12px)" },
        {
          scale: 1,
          filter: "blur(0px)",
          duration: 1.4,
          ease: "power2.out",
          transformOrigin: "50% 50%",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 75%",
          },
        },
      );

      const spinEl = orbSpinRef.current;
      let removeSpinTicker: (() => void) | undefined;
      if (spinEl) {
        gsap.set(spinEl, { transformOrigin: "50% 50%", force3D: true });
        const tickSlot = (time: number) => {
          const deg =
            ((time * 0.001 * AMBIENT_SLOT_ROT_SPEED * 180) / Math.PI) % 360;
          gsap.set(spinEl, { rotation: deg });
        };
        gsap.ticker.add(tickSlot);
        removeSpinTicker = () => gsap.ticker.remove(tickSlot);
      }

      // Old way slides in from left with glow trail
      gsap.fromTo(
        ".comparison-old",
        { x: -50, opacity: 0, filter: "blur(6px)" },
        {
          x: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: sectionRef.current, start: "top 65%" },
        },
      );

      // OneWork slides in from right with glow trail
      gsap.fromTo(
        ".comparison-new",
        { x: 50, opacity: 0, filter: "blur(6px)" },
        {
          x: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: sectionRef.current, start: "top 65%" },
        },
      );

      // Staggered row reveals inside each card
      gsap.fromTo(
        ".comparison-row",
        { x: -10, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          stagger: 0.06,
          duration: 0.4,
          ease: "power2.out",
          scrollTrigger: { trigger: sectionRef.current, start: "top 55%" },
        },
      );

      return () => {
        removeSpinTicker?.();
      };
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="comparison-section"
      data-biome="blue"
      className="relative w-full py-32 px-4 sm:px-8 md:px-16 lg:px-24 overflow-hidden"
      aria-label="OneWork vs scattered tools"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(59,130,246,0.04) 0%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      {/* Large slow-spinning logo torus — centered in section */}
      <div
        className="comparison-orb-wrap absolute inset-0 flex items-center justify-center pointer-events-none opacity-0"
        style={{ zIndex: 0 }}
        aria-hidden="true"
      >
        <div className="comparison-orb-reveal scale-[0.72] sm:scale-90 md:scale-100">
          <div
            ref={orbSpinRef}
            className="comparison-orb-spin"
            style={{
              filter: "drop-shadow(0 0 80px rgba(59,130,246,0.12))",
            }}
          >
            <IridescentOrb variant="ambient" size={320} compact />
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto">
        <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-4 text-center">
          WHY ONEWORK
        </p>
        <h2
          className="font-display font-extrabold uppercase text-white text-center mb-4"
          style={{
            fontSize: "clamp(28px, 5vw, 64px)",
            letterSpacing: "-0.02em",
          }}
        >
          STOP SWITCHING TABS
        </h2>
        <p className="font-terminal text-[10px] text-white uppercase tracking-[0.25em] text-center mb-16">
          The average dev team runs 7+ tools. OneWork is one.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Old way */}
          <div
            className="comparison-old glass-card p-4 sm:p-6"
            style={{ borderColor: "rgba(255,255,255,0.05)" }}
          >
            <p className="font-terminal text-xs uppercase tracking-[0.3em] text-white/25 mb-5 pb-4 border-b border-white/5">
              THE OLD WAY
            </p>
            <div className="flex flex-col gap-3">
              {ROWS.map((row) => (
                <div
                  key={row.category}
                  className="comparison-row flex items-start gap-3"
                >
                  <span
                    className="font-terminal text-[10px] mt-0.5 shrink-0"
                    style={{ color: "rgba(239,68,68,0.5)" }}
                  >
                    ✕
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-terminal text-xs text-white/70 uppercase tracking-wider">
                      {row.category}
                    </span>
                    <span className="font-terminal text-[11px] text-white/50 uppercase tracking-wider">
                      {row.old}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p
              className="font-terminal text-[11px] uppercase tracking-wider mt-5 pt-4 border-t border-white/5"
              style={{ color: "rgba(239,68,68,0.6)" }}
            >
              $83+ / user / month · 7 subscriptions · infinite context switching
            </p>
          </div>

          {/* OneWork */}
          <div
            className="comparison-new glass-card comparison-glow-enter p-4 sm:p-6"
            style={{
              borderColor: "rgba(59,130,246,0.2)",
              boxShadow:
                "0 0 40px rgba(59,130,246,0.05), 0 8px 32px rgba(0,0,0,0.45)",
            }}
          >
            <p
              className="font-terminal text-xs uppercase tracking-[0.3em] mb-5 pb-4 border-b"
              style={{
                color: "rgba(59,130,246,0.55)",
                borderColor: "rgba(59,130,246,0.1)",
              }}
            >
              ONEWORK
            </p>
            <div className="flex flex-col gap-3">
              {ROWS.map((row) => (
                <div
                  key={row.category}
                  className="comparison-row flex items-start gap-3"
                >
                  <span
                    className="font-terminal text-[10px] mt-0.5 shrink-0"
                    style={{ color: "var(--biome-primary)" }}
                  >
                    ✓
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-terminal text-xs text-white/80 uppercase tracking-wider">
                      {row.category}
                    </span>
                    <span className="font-terminal text-[11px] text-white uppercase tracking-wider">
                      {row.ow}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p
              className="font-terminal text-[11px] uppercase tracking-wider mt-5 pt-4 border-t"
              style={{
                color: "var(--ow-blue)",
                borderColor: "rgba(59,130,246,0.1)",
              }}
            >
              From $0 / month · one workspace · everything included
            </p>
          </div>
        </div>

        <p className="font-terminal text-[12px] text-white uppercase tracking-[0.35em] text-center mt-10">
          One subscription · One interface · One source of truth
        </p>
      </div>
    </section>
  );
}
