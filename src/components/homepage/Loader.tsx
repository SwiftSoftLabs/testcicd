"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

interface LoaderProps {
  onContentReady: () => void;
  onExited: () => void;
}

// Fibonacci sphere point distribution for glyph placement
function fibonacciSphere(count: number, radius: number) {
  const points: {
    x: number;
    y: number;
    z: number;
    phi: number;
    theta: number;
  }[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const phi = Math.acos(y);

    points.push({
      x: radiusAtY * Math.cos(theta) * radius,
      y: y * radius,
      z: radiusAtY * Math.sin(theta) * radius,
      phi,
      theta,
    });
  }
  return points;
}

/** Match React SSR style serialization (~4 decimal places) to avoid hydration mismatch. */
function sphereGlyphTransform(x: number, y: number, z: number) {
  return `translate3d(${x.toFixed(4)}px, ${y.toFixed(4)}px, ${z.toFixed(4)}px)`;
}

const GLYPHS = ["/", "O", "W", ".", "1", "∞", "·", "—"];
const GLYPH_COUNT = 80;

export default function Loader({ onContentReady, onExited }: LoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sphereRef = useRef<HTMLDivElement>(null);
  const sphereWrapRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<"counting" | "sphere" | "bloom" | "click">(
    "counting",
  );
  const [entered, setEntered] = useState(false);

  const spherePoints = useMemo(() => fibonacciSphere(GLYPH_COUNT, 90), []);

  const handleEnter = useCallback(() => {
    if (entered) return;
    setEntered(true);

    // Dismiss loader
    const tl = gsap.timeline();

    // Flash bloom
    tl.to(".loader-sphere", {
      scale: 1.5,
      opacity: 0,
      duration: 0.6,
      ease: "power2.in",
    });

    tl.to(
      containerRef.current,
      {
        opacity: 0,
        duration: 0.5,
        ease: "power2.in",
        onStart() {
          onContentReady();
          if (containerRef.current) {
            containerRef.current.style.pointerEvents = "none";
          }
        },
        onComplete: () => onExited(),
      },
      "-=0.2",
    );
  }, [entered, onContentReady, onExited]);

  // Sphere reacts to cursor proximity — leans toward the pointer
  useGSAP(() => {
    const wrap = sphereWrapRef.current;
    if (!wrap) return;
    function onMove(e: MouseEvent) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      gsap.to(wrap, {
        rotateY: nx * 16,
        rotateX: -ny * 16,
        duration: 0.9,
        ease: "power2.out",
      });
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useGSAP(
    () => {
      const obj = { val: 0 };
      const tl = gsap.timeline();

      // Phase 1: Counter 0 → 100 over 800ms
      tl.to(obj, {
        val: 100,
        duration: 0.8,
        ease: "power2.inOut",
        onUpdate() {
          setCount(Math.round(obj.val));
        },
        onComplete() {
          setPhase("sphere");
        },
      });

      // Phase 2: Sphere appears (glyphs fade in staggered)
      tl.call(
        () => {
          gsap.fromTo(
            ".sphere-glyph",
            { opacity: 0, scale: 0 },
            {
              opacity: 1,
              scale: 1,
              duration: 0.4,
              stagger: { each: 0.015, from: "random" },
              ease: "back.out(1.5)",
            },
          );
        },
        [],
        "+=0.1",
      );

      // Phase 3: Bloom tendrils after 1.5s
      tl.call(
        () => {
          setPhase("bloom");
          const tendrils = document.querySelectorAll(".loader-tendril");
          tendrils.forEach((t, i) => {
            setTimeout(() => t.classList.add("active"), i * 80);
          });
        },
        [],
        "+=1.5",
      );

      // Phase 4: Show click-to-enter
      tl.call(
        () => {
          setPhase("click");
          gsap.fromTo(
            ".click-to-enter",
            { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
          );
        },
        [],
        "+=1.2",
      );
    },
    { scope: containerRef },
  );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center cursor-pointer"
      style={{ backgroundColor: "var(--bg-base)" }}
      aria-label="Loading OneWork"
      role="status"
      onClick={phase === "click" ? handleEnter : undefined}
      onKeyDown={(e) => e.key === "Enter" && phase === "click" && handleEnter()}
      tabIndex={0}
    >
      {/* Counter */}
      <span
        className="font-terminal text-xs tracking-[0.4em] mb-10 tabular-nums transition-opacity duration-300"
        style={{
          color: "rgba(59, 130, 246, 0.4)",
          opacity: phase === "counting" ? 1 : 0.3,
        }}
        aria-live="polite"
      >
        /{String(count).padStart(3, "0")}
      </span>

      {/* Typographic Sphere */}
      <div ref={sphereWrapRef} className="loader-sphere-container">
        <div ref={sphereRef} className="loader-sphere">
          {spherePoints.map((pt, i) => (
            <span
              key={i}
              className="sphere-glyph"
              style={{
                transform: sphereGlyphTransform(pt.x, pt.y, pt.z),
              }}
            >
              {GLYPHS[i % GLYPHS.length]}
            </span>
          ))}
        </div>

        {/* Bloom tendrils */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="loader-tendril"
            style={{
              left: "50%",
              top: "50%",
              transform: `rotate(${i * 45}deg) translateY(-80px)`,
            }}
          />
        ))}

        {/* Pulse ring */}
        {phase === "click" && <div className="click-to-enter-ring" />}
      </div>

      {/* Brand name */}
      <div
        className="text-mask-reveal font-display font-extrabold text-5xl md:text-7xl tracking-[0.25em] uppercase select-none mt-8 transition-opacity duration-500"
        aria-label="OneWork"
        style={{ opacity: phase !== "counting" ? 1 : 0 }}
      >
        ONEWORK
      </div>

      {/* Click to enter */}
      <div
        className="click-to-enter mt-10 flex flex-col items-center gap-2"
        style={{ opacity: 0 }}
      >
        <span
          className="font-terminal text-[10px] uppercase tracking-[0.5em]"
          style={{ color: "rgba(59, 130, 246, 0.5)" }}
        >
          {phase === "click" ? "CLICK TO ENTER" : "INITIALIZING"}
        </span>
        {phase === "click" && (
          <span
            className="font-terminal text-[10px] tracking-[0.3em]"
            style={{ color: "rgba(59, 130, 246, 0.25)" }}
          >
            ◉
          </span>
        )}
      </div>
    </div>
  );
}
