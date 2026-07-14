"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

const ContactBubbleCanvas = dynamic(() => import("./ContactBubbleCanvas"), {
  ssr: false,
});

const JellyfishScene = dynamic(() => import("./JellyfishScene"), {
  ssr: false,
});

const TEAL_PRIMARY = "#14B8A6";

gsap.registerPlugin(ScrollTrigger);

/* ──────────────────────────────────────────────────────────────
   Contact — inverted hero ambience
   Soda bubbles cascade from the top; jellyfish swims downward.
   ────────────────────────────────────────────────────────────── */

export default function ContactSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(
        ".contact-reveal",
        { y: 30, opacity: 0, filter: "blur(8px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          stagger: 0.12,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
          },
        },
      );
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="contact-section"
      data-biome="teal"
      className="relative w-full min-h-screen flex flex-col items-center justify-center px-4 sm:px-8 text-center overflow-hidden"
      style={{
        WebkitMaskImage:
          "linear-gradient(to top, #000 0%, #000 72%, transparent 100%)",
        maskImage:
          "linear-gradient(to top, #000 0%, #000 72%, transparent 100%)",
      }}
      aria-label="Contact section"
    >
      <ContactBubbleCanvas primaryColor={TEAL_PRIMARY} />
      <JellyfishScene biomePrimary={TEAL_PRIMARY} direction="down" />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(20,184,166,0.06) 0%, transparent 70%)",
          zIndex: 2,
        }}
        aria-hidden="true"
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(20,184,166,0.06) 0%, transparent 65%)",
          zIndex: 2,
        }}
        aria-hidden="true"
      />

      <p className="contact-reveal relative z-10 font-terminal text-[12px] uppercase tracking-[0.45em] text-white mb-8">
        GET STARTED
      </p>
      <h2
        className="contact-reveal relative z-10 font-display font-extrabold uppercase text-white leading-tight mb-8"
        style={{
          fontSize: "clamp(36px, 7vw, 88px)",
          letterSpacing: "-0.02em",
        }}
      >
        READY TO SHIP
        <br />
        <span
          style={{
            color: "transparent",
            WebkitTextStroke: "1.5px rgba(20,184,166,0.55)",
          }}
        >
          FASTER?
        </span>
      </h2>
      <p className="contact-reveal relative z-10 font-terminal text-xs text-white uppercase tracking-[0.25em] max-w-xs leading-relaxed mb-12">
        Join teams already using OneWork to close the loop on their workflows.
      </p>
      <a
        href="/signup"
        className="contact-reveal relative z-10 font-display font-bold text-sm uppercase tracking-[0.2em] px-8 py-4 border border-white/20
                           text-white/70 hover:text-white hover:border-white/40 transition-all duration-300
                           hover:bg-white/5"
        aria-label="Sign up for OneWork"
      >
        START FOR FREE
      </a>
    </section>
  );
}
