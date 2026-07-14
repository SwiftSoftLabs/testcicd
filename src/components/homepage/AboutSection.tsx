"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

const HEADLINE =
  "BUILT FOR TEAMS THAT SHIP FAST. DESIGNED FOR DEVELOPERS WHO DEMAND CLARITY.";

const DEMO_VIDEO_SRC = "/demo.mp4";

function getVideoParallaxOffset() {
  if (typeof window === "undefined") return 140;
  return Math.min(window.innerHeight * 0.12, 140);
}

export default function AboutSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoParallaxRef = useRef<HTMLDivElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const missionRef = useRef<HTMLParagraphElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const video = videoRef.current;
    if (!video) return;

    const play = () => void video.play().catch(() => {});

    const onLoaded = () => {
      play();
    };

    video.addEventListener("loadeddata", onLoaded);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onLoaded();
    } else {
      play();
    }

    return () => {
      video.removeEventListener("loadeddata", onLoaded);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion || !videoParallaxRef.current) return;

    const parallaxEl = videoParallaxRef.current;
    const offset = getVideoParallaxOffset();

    const syncParallax = () => {
      const hero = document.getElementById("hero-section");
      if (!hero) return;

      const heroBottom = hero.getBoundingClientRect().bottom;
      const vh = window.innerHeight;
      const progress = gsap.utils.clamp(
        0,
        1,
        gsap.utils.mapRange(vh, 0, 0, 1, heroBottom),
      );
      // While hero overlaps: slide video down from tucked (-offset) to natural (0).
      // Once the hero is gone, keep video anchored (no additional drift).
      const y = -offset * (1 - progress);

      gsap.set(parallaxEl, { y, force3D: true });
    };

    gsap.ticker.add(syncParallax);
    requestAnimationFrame(syncParallax);

    return () => {
      gsap.ticker.remove(syncParallax);
      gsap.set(parallaxEl, { clearProps: "transform" });
    };
  }, [reduceMotion]);

  useGSAP(
    () => {
      const words =
        sectionRef.current?.querySelectorAll<HTMLSpanElement>(".about-word");
      if (!words || words.length === 0) return;

      gsap.fromTo(
        words,
        { opacity: 0.06, filter: "blur(6px)", y: 8 },
        {
          opacity: 1,
          filter: "blur(0px)",
          y: 0,
          stagger: 0.035,
          ease: "none",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
            end: "center 35%",
            scrub: 1.2,
          },
        },
      );

      gsap.fromTo(
        ".about-stat",
        { y: 30, opacity: 0, scale: 0.9 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          stagger: 0.12,
          duration: 0.7,
          ease: "back.out(1.3)",
          scrollTrigger: {
            trigger: ".about-stats",
            start: "top 80%",
          },
        },
      );
    },
    { scope: sectionRef, dependencies: [reduceMotion] },
  );

  return (
    <section
      ref={sectionRef}
      id="about-section"
      data-biome="purple"
      className={`relative w-full overflow-visible px-4 sm:px-8 md:px-16 lg:px-24 pb-20 sm:pb-24 ${
        reduceMotion ? "pt-16 sm:pt-20 z-[1]" : "-mt-[14vh] pt-0 z-[1]"
      }`}
      aria-label="About OneWork"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(139,92,246,0.06) 0%, transparent 65%)",
        }}
        aria-hidden="true"
      />

      <div
        ref={videoParallaxRef}
        className={`about-video-parallax relative w-full max-w-5xl mx-auto will-change-transform ${
          reduceMotion ? "mt-16 sm:mt-20" : "mt-0"
        }`}
      >
        <div
          ref={videoFrameRef}
          className="about-demo-video relative w-full aspect-video max-h-[min(38vh,420px)] mx-auto min-h-[180px]"
          aria-hidden="true"
        >
          <div className="relative h-full w-full min-h-[180px] overflow-hidden rounded-lg glass-card glow-border">
            {!reduceMotion ? (
              <>
                <video
                  ref={videoRef}
                  src={DEMO_VIDEO_SRC}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="auto"
                  disablePictureInPicture
                  disableRemotePlayback
                  className="absolute inset-0 h-full w-full object-cover"
                  tabIndex={-1}
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(139,92,246,0.08) 0%, transparent 70%)",
                  }}
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(to bottom, var(--bg-base) 0%, transparent 10%, transparent 90%, var(--bg-base) 100%)",
                    opacity: 0.35,
                  }}
                />
              </>
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(139,92,246,0.08) 0%, var(--bg-base) 75%)",
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-12 sm:gap-16 w-full max-w-5xl mx-auto pt-8 sm:pt-10">
        <p
          ref={missionRef}
          className="font-terminal text-[12px] uppercase tracking-[0.4em] text-white"
        >
          OUR MISSION
        </p>

        <p
          className="font-display font-bold uppercase text-center leading-tight max-w-4xl"
          style={{ fontSize: "clamp(28px, 5.5vw, 72px)" }}
          aria-label={HEADLINE}
        >
          {HEADLINE.split(" ").map((word, i) => (
            <span
              key={i}
              className="about-word inline-block mr-[0.22em] text-white"
            >
              {word}
            </span>
          ))}
        </p>

        <div className="about-stats grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 md:gap-12 max-w-2xl w-full">
          {[
            { value: "6+", label: "Core Modules" },
            { value: "100%", label: "Privacy" },
            { value: "AI", label: "Integrations" },
          ].map(({ value, label }) => (
            <div
              key={label}
              className="about-stat flex flex-col items-center gap-1"
            >
              <span
                className="font-display font-extrabold leading-none"
                style={{
                  fontSize: "clamp(24px, 3.5vw, 48px)",
                  background:
                    "linear-gradient(135deg, var(--chart-blue), var(--chart-purple))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {value}
              </span>
              <span className="font-terminal text-[12px] uppercase tracking-[0.3em] text-white">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
