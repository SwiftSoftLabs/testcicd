"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  getHeroOrbScrollProgress,
  HERO_ORB_SCROLL,
} from "@/lib/hero-orb-scroll";

/* ──────────────────────────────────────────────────────────────
   IridescentOrb — true 3D WebGL "glass marble"

   A chromatic-glass torus ring wrapping a 3D extrusion of the
   OneWork "layers" mark (three stacked plates). Physical glass
   material with transmission + iridescence gives the rainbow
   index-of-refraction dispersion seen on the Active Theory logo.
   Reacts to cursor proximity with a vector displacement.
   ────────────────────────────────────────────────────────────── */

interface IridescentOrbProps {
  /** Drop outer margin when orb sits in the hero slot */
  compact?: boolean;
  /** Canvas edge length in px — default 168 (hero) or 320 (ambient) */
  size?: number;
  /**
   * hero — scroll + cursor reactivity (homepage logo slot)
   * ambient — larger, slow steady spin (e.g. Why section backdrop)
   */
  variant?: "hero" | "ambient";
}

const HERO_ORB_SIZE = 168;
const AMBIENT_ORB_SIZE = 320;

/** Ambient Why-section — slow spin around vertical (Y) axis */
const AMBIENT_SPIN = {
  ringRotY: 0.1,
  markRotY: 0.14,
  bob: 0.04,
  tiltX: 0.32,
} as const;
/** Logo ring/halo — locked to DESIGN.md accent (not scroll biome) */
const LOGO_ACCENT = "#3B82F6";
const LOGO_ACCENT_LIGHT = "#60A5FA";

function isCapableDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const hasWebGL2 = !!document.createElement("canvas").getContext("webgl2");
  return mem >= 4 && cores >= 4 && hasWebGL2;
}

export default function IridescentOrb({
  compact = false,
  size: sizeProp,
  variant = "hero",
}: IridescentOrbProps) {
  const isAmbient = variant === "ambient";
  const orbSize =
    sizeProp ?? (isAmbient ? AMBIENT_ORB_SIZE : HERO_ORB_SIZE);

  const mountRef = useRef<HTMLDivElement>(null);
  const logoColorRef = useRef(new THREE.Color(LOGO_ACCENT));
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => {
    // Capability probe touches navigator/document — must run client-side only
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebgl(isCapableDevice());
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || webgl !== true) return;

    const DPR = Math.min(window.devicePixelRatio, 2);

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(orbSize, orbSize);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 5.2);

    // ── Environment (drives glass refraction / reflections) ──
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    const envTex = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envTex;

    // ── Chromatic-glass ring (torus) ──
    const ringGeo = new THREE.TorusGeometry(1.18, 0.13, 48, 160);
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(LOGO_ACCENT),
      metalness: 0,
      roughness: 0.04,
      transmission: 1,
      thickness: 0.85,
      ior: 1.6,
      iridescence: 0.35,
      iridescenceIOR: 1.34,
      iridescenceThicknessRange: [180, 420],
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      transparent: true,
      envMapIntensity: 1.8,
      specularIntensity: 1,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ring);

    // ── 3D OneWork "layers" mark — three stacked glass plates ──
    const markGroup = new THREE.Group();
    const plateGeo = new THREE.BoxGeometry(1.05, 0.075, 1.05);
    const plateOffsets = [0.34, 0, -0.34];

    const plateMats: THREE.MeshPhysicalMaterial[] = [];
    plateOffsets.forEach((y, i) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(LOGO_ACCENT),
        metalness: 0.1,
        roughness: 0.12,
        transmission: 0.65,
        thickness: 0.4,
        ior: 1.5,
        iridescence: 0.3,
        iridescenceIOR: 1.4,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        emissive: new THREE.Color(LOGO_ACCENT),
        emissiveIntensity: 0.22 + i * 0.06,
        transparent: true,
        envMapIntensity: 1.4,
      });
      plateMats.push(mat);
      const plate = new THREE.Mesh(plateGeo, mat);
      plate.position.y = y;
      markGroup.add(plate);
    });

    // Rotate plates into the isometric "layers" diamond read
    markGroup.rotation.set(-0.62, Math.PI / 4, 0);
    markGroup.scale.setScalar(0.62);
    scene.add(markGroup);

    // ── Chromatic accent lights ──
    const keyLight = new THREE.PointLight(0xffffff, 14, 20);
    keyLight.position.set(2.5, 2.5, 3);
    scene.add(keyLight);
    const rimA = new THREE.PointLight(LOGO_ACCENT, 10, 18);
    rimA.position.set(-3, -1.5, 1.5);
    scene.add(rimA);
    const rimB = new THREE.PointLight(LOGO_ACCENT_LIGHT, 8, 18);
    rimB.position.set(2, -2.5, -2);
    scene.add(rimB);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // ── Cursor proximity ──
    const mouse = new THREE.Vector2(0, 0);
    function onMove(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      mouse.set(
        (e.clientX - cx) / window.innerWidth,
        -(e.clientY - cy) / window.innerHeight,
      );
    }
    window.addEventListener("mousemove", onMove, { passive: true });

    // ── Render loop ──
    const target = new THREE.Color(LOGO_ACCENT);
    let raf = 0;
    const start = performance.now();
    function frame() {
      raf = requestAnimationFrame(frame);
      const t = (performance.now() - start) * 0.001;

      target.copy(logoColorRef.current);
      ringMat.color.lerp(target, 0.04);
      plateMats.forEach((m) => {
        m.color.lerp(target, 0.04);
        m.emissive.lerp(target, 0.04);
      });

      const sp = isAmbient ? 0 : getHeroOrbScrollProgress();
      const wander = isAmbient ? 1 : 1 - sp * 0.65;
      const cursorMix = isAmbient ? 0.12 : 0.3;

      if (isAmbient) {
        ring.rotation.y = t * AMBIENT_SPIN.ringRotY;
        ring.rotation.x =
          AMBIENT_SPIN.tiltX + Math.sin(t * 0.35) * 0.04 + mouse.y * cursorMix;
        ring.rotation.z = mouse.x * cursorMix * 0.5;
        markGroup.rotation.y = Math.PI / 4 + t * AMBIENT_SPIN.markRotY;
        markGroup.rotation.x =
          -0.62 + Math.sin(t * 0.45) * AMBIENT_SPIN.bob + mouse.y * 0.15;
        markGroup.position.y = Math.sin(t * 0.55) * 0.05;
        ring.scale.setScalar(1);
      } else {
        ring.rotation.z =
          t * HERO_ORB_SCROLL.idleRotZ + sp * HERO_ORB_SCROLL.maxRotZ;
        ring.rotation.x =
          sp * HERO_ORB_SCROLL.maxRotX +
          (Math.sin(t * 0.5) * 0.08 + mouse.y * cursorMix) * wander;
        ring.rotation.y =
          sp * HERO_ORB_SCROLL.maxRotZ * 0.5 +
          (Math.cos(t * 0.4) * 0.08 + mouse.x * cursorMix) * wander;
        markGroup.rotation.y = Math.PI / 4 + t * 0.55;
        markGroup.rotation.x =
          -0.62 + Math.sin(t * 0.8) * 0.07 + mouse.y * 0.4;
        markGroup.position.y = Math.sin(t * 1.2) * 0.06;
        const lean = Math.min(Math.hypot(mouse.x, mouse.y) * 2.4, 1);
        ring.scale.setScalar(1 + lean * 0.06);
      }

      renderer.render(scene, camera);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      ringGeo.dispose();
      ringMat.dispose();
      plateGeo.dispose();
      plateMats.forEach((m) => m.dispose());
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [webgl, isAmbient, orbSize]);

  // ── CSS fallback for non-WebGL / low-power devices ──
  const wrapClass = compact
    ? "relative flex items-center justify-center"
    : isAmbient
      ? "relative flex items-center justify-center"
      : "relative flex items-center justify-center mb-10";

  if (webgl === false) {
    return (
      <div
        className={wrapClass}
        style={{ width: orbSize, height: orbSize }}
        aria-hidden="true"
      >
        <div
          className="orb-bloom absolute"
          style={{ width: orbSize, height: orbSize }}
        />
        <div
          className="orb-dispersion absolute"
          style={{ width: orbSize - 12, height: orbSize - 12 }}
        />
        <div
          className="orb-ring absolute"
          style={{ width: orbSize - 28, height: orbSize - 28 }}
        />
        <div
          className="orb-core absolute"
          style={{ width: orbSize - 56, height: orbSize - 56 }}
        />
        <span
          className="material-symbols-outlined orb-mark relative z-10 select-none"
          style={{ fontVariationSettings: "'FILL' 1", fontSize: "32px" }}
          aria-hidden="true"
        >
          layers
        </span>
      </div>
    );
  }

  return (
    <div
      className={wrapClass}
      style={{ width: orbSize, height: orbSize }}
      aria-hidden="true"
    >
      {/* Soft CSS bloom behind the WebGL orb */}
      <div
        className="orb-bloom absolute"
        style={{
          width: orbSize - 20,
          height: orbSize - 20,
          opacity: isAmbient ? 0.45 : 0.55,
        }}
      />
      <div
        ref={mountRef}
        className="relative z-10"
        style={{ width: orbSize, height: orbSize }}
      />
    </div>
  );
}
