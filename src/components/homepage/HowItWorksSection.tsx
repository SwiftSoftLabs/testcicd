"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

const HowItWorksDnaCanvas = dynamic(() => import("./HowItWorksDnaCanvas"), {
  ssr: false,
});

const STEPS = [
  {
    number: "01",
    title: "UNIFY YOUR TOOLS",
    desc: "Connect your repos, email, calendar, and chat. Everything your team touches lives in one workspace — no more tab-switching.",
    screen: {
      tab: "DASHBOARD",
      rows: [
        {
          icon: "task_alt",
          label: "Sprint Alpha — 12 tasks",
          color: "#3B82F6",
        },
        { icon: "folder", label: "Design Assets / v3", color: "#14B8A6" },
        { icon: "mail", label: "Inbox — 3 unread", color: "#8B5CF6" },
      ],
    },
  },
  {
    number: "02",
    title: "SPRINT & COLLABORATE",
    desc: "Kanban boards, live presence, and real-time sync. See exactly what your team is working on as it happens.",
    screen: {
      tab: "SPRINT BOARD",
      rows: [
        { icon: "group", label: "4 members online", color: "#14B8A6" },
        { icon: "task_alt", label: "12 tasks in progress", color: "#3B82F6" },
        { icon: "insert_chart", label: "Velocity: 42 pts", color: "#EF4444" },
      ],
    },
  },
  {
    number: "03",
    title: "SHIP WITH CONFIDENCE",
    desc: "Code reviews, burndown charts, and automated reporting. Close the loop between code and delivery.",
    screen: {
      tab: "CODE BRIDGE",
      rows: [
        {
          icon: "merge_type",
          label: "3 PRs awaiting review",
          color: "#8B5CF6",
        },
        {
          icon: "insert_chart",
          label: "Sprint 87% complete",
          color: "#14B8A6",
        },
        {
          icon: "check_circle",
          label: "CI passing — deploy ready",
          color: "#3B82F6",
        },
      ],
    },
  },
];

export default function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Staggered step reveals with parallax depth
      gsap.fromTo(
        ".hiw-step",
        { y: 60, opacity: 0, filter: "blur(4px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          stagger: 0.2,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 65%",
          },
        },
      );

      // Mock screens float in with parallax depth
      gsap.fromTo(
        ".hiw-screen",
        { y: 40, opacity: 0, rotateX: 8, scale: 0.95 },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          scale: 1,
          stagger: 0.2,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 60%",
          },
        },
      );
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      data-biome="teal"
      className="relative w-full py-32 px-4 sm:px-8 md:px-16 lg:px-24"
      aria-label="How OneWork works"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(20,184,166,0.05) 0%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      <HowItWorksDnaCanvas sectionRef={sectionRef} />

      <div className="pointer-events-none relative z-10 max-w-5xl mx-auto">
        <p className="font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-4 text-center">
          HOW IT WORKS
        </p>
        <h2
          className="font-display font-extrabold uppercase text-white text-center mb-20"
          style={{
            fontSize: "clamp(28px, 5vw, 64px)",
            letterSpacing: "-0.02em",
          }}
        >
          THREE STEPS TO{" "}
          <span
            style={{
              color: "transparent",
              WebkitTextStroke: "1.5px rgba(20,184,166,0.55)",
            }}
          >
            FLOW STATE
          </span>
        </h2>

        <div className="flex flex-col gap-20">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="hiw-step flex flex-col md:flex-row items-center gap-10 md:gap-12 lg:gap-16"
            >
              {/* Step info */}
              <div className="flex-1 flex flex-col gap-4">
                <span
                  className="font-terminal text-[10px] tracking-[0.5em]"
                  style={{ color: "var(--ow-teal)" }}
                >
                  STEP {step.number}
                </span>
                <h3
                  className="font-display font-extrabold uppercase text-white"
                  style={{
                    fontSize: "clamp(20px, 3vw, 36px)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {step.title}
                </h3>
                <p className="font-terminal text-sm text-white/75 uppercase tracking-wider leading-relaxed max-w-sm">
                  {step.desc}
                </p>
              </div>

              {/* CSS mock screen — glassmorphic with refraction overlay */}
              <div
                className="hiw-screen w-full max-w-[240px] mx-auto md:mx-0 shrink-0 rounded-xl overflow-hidden border [transform-style:preserve-3d]"
                style={{
                  background: "rgba(0,0,0,0.7)",
                  backdropFilter: "blur(16px) saturate(1.3)",
                  borderColor: "rgba(59,130,246,0.12)",
                  boxShadow:
                    "0 12px 40px rgba(0,0,0,0.5), 0 0 30px rgba(59,130,246,0.03)",
                }}
                aria-hidden="true"
              >
                {/* Window chrome */}
                <div
                  className="flex items-center gap-1.5 px-3 py-2 border-b"
                  style={{ borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: "rgba(239,68,68,0.5)" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: "rgba(245,158,11,0.5)" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: "rgba(20,184,166,0.5)" }}
                  />
                  <span className="font-terminal text-[7px] text-white/25 ml-2 uppercase tracking-wider">
                    {step.screen.tab}
                  </span>
                </div>
                {/* Content rows */}
                <div className="flex flex-col">
                  {step.screen.rows.map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-2.5 border-b"
                      style={{ borderColor: "rgba(255,255,255,0.03)" }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: "12px",
                          color: row.color,
                          fontVariationSettings: "'FILL' 1",
                        }}
                      >
                        {row.icon}
                      </span>
                      <span className="font-terminal text-[10px] text-white/70 uppercase tracking-wider">
                        {row.label}
                      </span>
                      <div
                        className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: row.color, opacity: 0.5 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
