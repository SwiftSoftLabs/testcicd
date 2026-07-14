"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

const FeaturesBubbleCanvas = dynamic(() => import("./FeaturesBubbleCanvas"), {
  ssr: false,
});

gsap.registerPlugin(ScrollTrigger);

const MODULES = [
  {
    icon: "task_alt",
    name: "Tasks",
    tagline: "Sprint boards, kanban, burndowns",
    ai: "AI prioritisation",
  },
  {
    icon: "folder",
    name: "Files",
    tagline: "Version-controlled storage + smart search",
    ai: "AI smart search",
  },
  {
    icon: "chat",
    name: "Chat",
    tagline: "Real-time threads and presence",
    ai: null,
  },
  {
    icon: "mail",
    name: "Email",
    tagline: "Unified inbox across providers",
    ai: "AI triage & drafts",
  },
  {
    icon: "calendar_month",
    name: "Calendar",
    tagline: "Smart scheduling synced to tasks",
    ai: "AI scheduling",
  },
  {
    icon: "merge_type",
    name: "Version Control",
    tagline: "GitHub / GitLab PRs and branches",
    ai: "AI review assist",
  },
  {
    icon: "insert_chart",
    name: "Analytics",
    tagline: "Velocity, burndown, team performance",
    ai: "AI insights",
  },
  {
    icon: "inbox",
    name: "Smart Inbox",
    tagline: "AI-prioritized unified notifications",
    ai: "AI-powered",
  },
] as const;

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Staggered card reveals with scale + rotation + glow
      gsap.fromTo(
        ".feature-card",
        {
          y: 50,
          opacity: 0,
          scale: 0.92,
          rotateX: 6,
          filter: "blur(4px)",
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotateX: 0,
          filter: "blur(0px)",
          stagger: 0.06,
          duration: 0.65,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 65%",
          },
        },
      );
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="features-section"
      data-biome="purple"
      className="relative w-full py-32 px-4 sm:px-8 md:px-16 lg:px-24 overflow-visible"
      aria-label="OneWork feature modules"
    >
      <FeaturesBubbleCanvas primaryColor="#8B5CF6" />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(139,92,246,0.05) 0%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-4">
            CAPABILITIES
          </p>
          <h2
            className="font-display font-extrabold uppercase text-white mb-4"
            style={{
              fontSize: "clamp(28px, 5vw, 64px)",
              letterSpacing: "-0.02em",
            }}
          >
            EVERYTHING YOUR TEAM NEEDS
          </h2>
          <span
            className="inline-block font-terminal text-[9px] px-3 py-1 border mb-4"
            style={{
              borderColor: "rgba(139,92,246,0.35)",
              color: "rgba(139,92,246,0.75)",
              background: "rgba(139,92,246,0.06)",
            }}
          >
            AI-POWERED THROUGHOUT
          </span>
          <p className="font-terminal text-xs text-white uppercase tracking-[0.2em] max-w-sm mx-auto">
            8 integrated modules. Zero context switching. Every one enhanced by
            AI.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {MODULES.map((mod) => (
            <div
              key={mod.name}
              className="feature-card glass-card glow-border p-4 sm:p-5 flex flex-col gap-3 relative [transform-style:preserve-3d]"
            >
              {mod.ai && (
                <span
                  className="absolute top-3 right-3 font-terminal text-[7px] px-1.5 py-0.5 rounded-sm border"
                  style={{
                    background: "rgba(139,92,246,0.08)",
                    borderColor: "rgba(139,92,246,0.2)",
                    color: "rgba(139,92,246,0.65)",
                  }}
                  aria-label={`AI feature: ${mod.ai}`}
                >
                  AI
                </span>
              )}
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: "28px",
                  color: "var(--biome-primary)",
                  fontVariationSettings: "'FILL' 1",
                }}
                aria-hidden="true"
              >
                {mod.icon}
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-display font-bold text-base uppercase tracking-wider text-white/80">
                  {mod.name}
                </span>
                <span className="font-terminal text-xs text-white/65 uppercase tracking-wider leading-relaxed">
                  {mod.tagline}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
