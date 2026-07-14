"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function useLenis() {
  const lenisRef = useRef<Lenis | null>(null);
  const scrollVelocityRef = useRef<number>(0);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      smoothWheel: true,
    });

    lenisRef.current = lenis;

    function onScroll(e: { velocity: number }) {
      scrollVelocityRef.current = e.velocity;
      ScrollTrigger.update();
    }

    lenis.on("scroll", onScroll);

    // Drive Lenis from GSAP's RAF so both run on the same frame
    function onRaf(time: number) {
      lenis.raf(time * 1000); // GSAP passes seconds, Lenis expects ms
    }
    gsap.ticker.add(onRaf);

    // Disable GSAP lag smoothing — it interferes with Lenis frame timing
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(onRaf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return { lenisRef, scrollVelocityRef };
}
