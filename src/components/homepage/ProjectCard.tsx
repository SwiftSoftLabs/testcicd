"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { HomepageProject } from "@/data/homepage-projects";

interface ProjectCardProps {
  project: HomepageProject;
  onVideoOpen: (project: HomepageProject) => void;
}

export default function ProjectCard({
  project,
  onVideoOpen,
}: ProjectCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const xTo = gsap.quickTo(el, "rotateY", {
      duration: 0.5,
      ease: "power3.out",
    });
    const yTo = gsap.quickTo(el, "rotateX", {
      duration: 0.5,
      ease: "power3.out",
    });

    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      xTo(dx * 10);
      yTo(-dy * 6);
      gsap.to(el, {
        "--card-brightness": 1.15,
        "--frost-blur": "0px",
        duration: 0.4,
        ease: "power2.out",
      } as gsap.TweenVars);
    }

    function onLeave() {
      xTo(0);
      yTo(0);
      gsap.to(el, {
        "--card-brightness": 1,
        "--frost-blur": "8px",
        duration: 0.6,
        ease: "power2.out",
      } as gsap.TweenVars);
    }

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  function handleClick() {
    if (project.videoSrc) onVideoOpen(project);
  }

  return (
    <div
      ref={cardRef}
      className="glass-card glass-card-frosted glow-border overflow-hidden cursor-pointer [transform-style:preserve-3d] will-change-transform h-full"
      onClick={handleClick}
      role="article"
      aria-label={`${project.name} by ${project.client}${project.videoSrc ? " — click to view" : ""}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      style={
        { "--card-brightness": 1, "--frost-blur": "8px" } as React.CSSProperties
      }
    >
      {/* Top accent line — biome color gradient */}
      <div
        className="absolute top-0 left-0 right-0 h-px z-10"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${project.uiColorPrimary} 50%, transparent 100%)`,
        }}
        aria-hidden="true"
      />

      {/* Edge chromatic glow */}
      <div
        className="absolute inset-0 rounded-[16px] opacity-0 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow: `0 0 30px ${project.uiColorPrimary}15, inset 0 0 20px ${project.uiColorPrimary}08`,
        }}
        aria-hidden="true"
      />

      {/* Category badge */}
      <div className="absolute top-4 left-4 z-10">
        <span className="font-terminal text-[12px] uppercase tracking-[0.3em] text-white">
          {project.category}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-10 p-6 pt-12 flex flex-col h-full">
        <h3 className="font-display font-bold text-xl uppercase tracking-wider text-white/90 leading-tight">
          {project.name}
        </h3>
        <p
          className="font-terminal text-[10px] uppercase tracking-[0.25em] mt-1"
          style={{ color: project.uiColorPrimary + "bb" }}
        >
          {project.client}
        </p>
        <p className="text-white/45 text-xs mt-4 leading-relaxed flex-1">
          {project.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mt-5">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="font-terminal text-[9px] uppercase tracking-wider px-2 py-0.5 border text-white/25 rounded-full"
              style={{ borderColor: "rgba(59,130,246,0.12)" }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Play indicator */}
        {project.videoSrc && (
          <div
            className="absolute bottom-4 right-4 font-terminal text-[9px] uppercase tracking-wider"
            style={{ color: "var(--ow-blue)" }}
          >
            ▶ PLAY
          </div>
        )}
      </div>
    </div>
  );
}
