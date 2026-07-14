"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import IridescentOrb from "./IridescentOrb";
import {
  getHeroOrbScrollProgress,
  getHeroOrbSlotMotion,
} from "@/lib/hero-orb-scroll";

gsap.registerPlugin(ScrollTrigger);

const JellyfishScene = dynamic(() => import("./JellyfishScene"), {
  ssr: false,
});

const HeroBubbleCanvas = dynamic(() => import("./HeroBubbleCanvas"), {
  ssr: false,
});

interface HeroSectionProps {
  visible: boolean;
  biomePrimary?: string;
}

/* ──────────────────────────────────────────────────────────────
   Act 1 — Hero
   The OneWork logo orb, with soda-bubble particles (global
   ParticleCanvas) rising from below and a jellyfish swimming up.
   ────────────────────────────────────────────────────────────── */

export default function HeroSection({
  visible,
  biomePrimary = "#3B82F6",
}: HeroSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const orbSlotRef = useRef<HTMLDivElement>(null);

  // Hero entrance animation — staggered blur reveals
  useGSAP(
    () => {
      if (!visible) return;
      const tl = gsap.timeline({ delay: 0.05 });

      tl.fromTo(
        ".hero-eyebrow",
        { y: 20, opacity: 0, filter: "blur(8px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.6,
          ease: "power2.out",
        },
      )
        .fromTo(
          ".hero-word",
          { y: 60, opacity: 0, filter: "blur(12px)", scale: 0.95 },
          {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            scale: 1,
            duration: 0.8,
            stagger: 0.12,
            ease: "power3.out",
          },
          "-=0.3",
        )
        .fromTo(
          ".hero-tagline",
          { y: 16, opacity: 0, filter: "blur(6px)" },
          {
            y: 0,
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.5,
            ease: "power2.out",
          },
          "-=0.3",
        )
        .fromTo(
          ".hero-cta",
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
          "-=0.2",
        );
    },
    { scope: sectionRef, dependencies: [visible] },
  );

  // Logo slot entrance + scroll-driven motion on .hero-orb-slot
  useGSAP(
    () => {
      if (!visible) return;

      const orbSlot = orbSlotRef.current;
      if (!orbSlot) return;

      gsap.set(orbSlot, {
        opacity: 1,
        transformOrigin: "50% 50%",
        force3D: true,
      });

      gsap.fromTo(
        orbSlot,
        { scale: 0.6, opacity: 0, filter: "blur(20px)" },
        {
          scale: 1,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.9,
          ease: "back.out(1.4)",
          delay: 0.1,
          clearProps: "filter",
        },
      );

      function tickOrb(time: number) {
        const motion = getHeroOrbSlotMotion(
          getHeroOrbScrollProgress(),
          time * 0.001,
        );
        gsap.set(orbSlot, motion);
      }

      gsap.ticker.add(tickOrb);

      const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150);

      const fadeTrigger = ScrollTrigger.create({
        trigger: "#hero-section",
        start: "bottom 65%",
        end: "bottom top",
        scrub: true,
        onUpdate: (self) => {
          gsap.set(orbSlot, { opacity: 1 - self.progress });
        },
        onLeaveBack: () => {
          gsap.to(orbSlot, { opacity: 1, duration: 0.3 });
        },
      });

      return () => {
        window.clearTimeout(refreshTimer);
        gsap.ticker.remove(tickOrb);
        fadeTrigger.kill();
      };
    },
    { scope: sectionRef, dependencies: [visible] },
  );

  return (
    <section
      ref={sectionRef}
      id="hero-section"
      data-biome="blue"
      className="relative z-30 w-full min-h-[100dvh] md:min-h-[92vh] flex flex-col items-center justify-start md:justify-center text-center px-6 pt-[calc(env(safe-area-inset-top,0px)+6.5rem)] md:pt-0 pb-8 md:pb-0 overflow-x-hidden overflow-y-visible bg-[var(--bg-base)]"
      style={{
        WebkitMaskImage:
          "linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)",
      }}
      aria-label="Hero"
    >
      {/* Soda bubbles — hero only, rising from the bottom */}
      <HeroBubbleCanvas primaryColor={biomePrimary} />

      {/* Jellyfish swimming upward */}
      <JellyfishScene biomePrimary={biomePrimary} direction="up" />

      {/* Radial vignette — OneWork blue */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 100%, rgba(59,130,246,0.06) 0%, transparent 70%)",
          zIndex: 2,
        }}
        aria-hidden="true"
      />

      {/* Hero text content */}
      <div
        className="relative md:-translate-y-[2.5vh]"
        style={{ zIndex: 3 }}
      >
        <p className="hero-eyebrow font-terminal text-[12px] uppercase tracking-[0.5em] text-white mb-6 opacity-0">
          THE UNIFIED WORKSPACE
        </p>

        {/* Orb sits in layout flow above the title — no overlap */}
        <div
          ref={orbSlotRef}
          className="hero-orb-slot relative mx-auto mb-3 overflow-visible"
          style={{
            width: 168,
            height: 168,
            opacity: visible ? undefined : 0,
          }}
          aria-hidden="true"
        >
          <div className="orb-in-slot">
            <IridescentOrb compact />
          </div>
        </div>

        <h1 className="leading-none select-none -mt-1" aria-label="OneWork">
          <span
            className="hero-word font-display font-extrabold uppercase text-white opacity-0 inline-block"
            style={{
              fontSize: "clamp(48px, 9vw, 104px)",
              letterSpacing: "-0.02em",
            }}
          >
            ONE
          </span>
          <span
            className="hero-word font-display font-extrabold uppercase opacity-0 inline-block"
            style={{
              fontSize: "clamp(48px, 9vw, 104px)",
              letterSpacing: "-0.02em",
              color: "transparent",
              WebkitTextStroke: "1.5px rgba(59,130,246,0.55)",
            }}
          >
            WORK
          </span>
        </h1>

        <p className="hero-tagline font-terminal text-xs text-white mt-8 max-w-sm leading-relaxed uppercase tracking-[0.25em] opacity-0">
          Tasks · Files · Comms · Code Reviews
        </p>

        <div
          className="hero-cta mt-16 flex flex-col items-center gap-2 opacity-0"
          aria-hidden="true"
        >
          <span className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white">
            SCROLL DOWN
          </span>
          <span className="scroll-indicator text-white text-lg">↓</span>
        </div>
      </div>
    </section>
  );
}
