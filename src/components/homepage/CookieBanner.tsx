"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

const STORAGE_KEY = "ow-cookie-consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss(accepted: boolean) {
    localStorage.setItem(STORAGE_KEY, accepted ? "accepted" : "rejected");
    gsap.to(bannerRef.current, {
      y: "100%",
      opacity: 0,
      duration: 0.35,
      ease: "power2.in",
      onComplete: () => setVisible(false),
    });
  }

  if (!visible) return null;

  return (
    <div
      ref={bannerRef}
      className="fixed bottom-0 left-0 right-0 z-[80] px-6 py-4 border-t backdrop-blur-sm
                       flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-base) 90%, transparent)",
        borderColor: "var(--border-default)",
      }}
      role="region"
      aria-label="Cookie consent"
    >
      <p className="font-terminal text-[10px] text-white/35 uppercase tracking-wider leading-relaxed max-w-lg">
        We use cookies to improve your experience.{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-white/60 transition-colors"
          aria-label="Read our privacy notice"
        >
          Privacy Notice
        </a>
      </p>
      <div className="flex gap-3 shrink-0">
        <button
          onClick={() => dismiss(false)}
          aria-label="Reject cookies"
          className="cursor-pointer font-terminal text-[10px] uppercase tracking-widest px-4 py-2
                               border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
        >
          REJECT
        </button>
        <button
          onClick={() => dismiss(true)}
          aria-label="Accept cookies"
          className="cursor-pointer font-terminal text-[10px] uppercase tracking-widest px-4 py-2
                               border border-white/25 text-white/60 hover:text-white hover:border-white/50 transition-colors"
        >
          ACCEPT
        </button>
      </div>
    </div>
  );
}
