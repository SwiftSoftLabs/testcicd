"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { HomepageProject } from "@/data/homepage-projects";

interface VideoModalProps {
  project: HomepageProject | null;
  onClose: () => void;
}

export default function VideoModal({ project, onClose }: VideoModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fade in when opened, fade out and clean up on close
  useEffect(() => {
    if (!project) return;
    gsap.fromTo(
      overlayRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.35, ease: "power2.out" },
    );
  }, [project]);

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (project) {
      document.addEventListener("keydown", onKey);
    }
    return () => document.removeEventListener("keydown", onKey);
  }, [project, onClose]);

  function handleClose() {
    gsap.to(overlayRef.current, {
      opacity: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = "";
        }
        onClose();
      },
    });
  }

  if (!project) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center dismiss-backdrop"
      style={{ backgroundColor: "color-mix(in srgb, var(--bg-base) 95%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${project.name} — case study`}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <button
        onClick={handleClose}
        aria-label="Close video"
        className="cursor-pointer absolute top-6 right-6 font-terminal text-[10px] uppercase tracking-[0.3em] text-white/40 hover:text-white transition-colors border border-white/10 hover:border-white/30 px-3 py-1.5"
      >
        [ CLOSE ]
      </button>

      <div className="flex flex-col items-center gap-4 max-w-[90vw]">
        <p className="font-display font-bold text-sm uppercase tracking-[0.25em] text-white/50">
          {project.client} — {project.name}
        </p>
        {project.videoSrc ? (
          <video
            ref={videoRef}
            src={project.videoSrc}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[80vh] rounded-lg"
            aria-label={`${project.name} case study video`}
          />
        ) : (
          <div className="w-[640px] max-w-[90vw] h-[360px] bg-white/5 rounded-lg flex items-center justify-center border border-white/8">
            <p className="font-terminal text-xs text-white/20 uppercase tracking-widest">
              No video available
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
