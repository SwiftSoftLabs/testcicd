"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createDNAHelixGroup } from "@/lib/dna-helix";

gsap.registerPlugin(ScrollTrigger);

interface HeroCanvasProps {
  biomePrimary: string;
  scrollVelocityRef: React.MutableRefObject<number>;
  scrollProgress: React.MutableRefObject<number>;
}

function isCapableDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const hasWebGL2 = !!document.createElement("canvas").getContext("webgl2");
  return mem >= 4 && cores >= 4 && hasWebGL2;
}

export default function HeroCanvas({
  biomePrimary,
  scrollVelocityRef,
  scrollProgress,
}: HeroCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biomeColorRef = useRef(new THREE.Color(biomePrimary));

  useEffect(() => {
    biomeColorRef.current.set(biomePrimary);
  }, [biomePrimary]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!isCapableDevice()) return;

    const W = mount.clientWidth;
    const H = mount.clientHeight;
    const DPR = Math.min(window.devicePixelRatio, 1.5);

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    // Slight elevation + look-at so the helix reads as a 3D spiral, not a flat wave
    camera.position.set(0, 0.6, 8.5);
    camera.lookAt(0, 0, 0);

    // ── DNA Double-Helix ──
    const {
      group: dnaGroup,
      strandMaterial,
      rungMaterial,
    } = createDNAHelixGroup({
      radius: 0.72,
      height: 7,
      turns: 2.5,
      strandSegments: 220,
      tubeRadius: 0.034,
      rungCount: 32,
    });

    // Position DNA centrally
    dnaGroup.position.set(0, 0, 0);
    scene.add(dnaGroup);

    // ── Mouse tracking ──
    const mouseNDC = new THREE.Vector2(0, 0);
    function onMouseMove(e: MouseEvent) {
      mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    // ── Resize ──
    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    // ── Render loop ──
    const targetBiomeColor = new THREE.Color(biomePrimary);

    function renderFrame(time: number) {
      const t = time * 0.001;
      const scrollVel = scrollVelocityRef.current;
      const sp = scrollProgress.current;

      // Lerp biome color
      targetBiomeColor.copy(biomeColorRef.current);
      (strandMaterial.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetBiomeColor,
        0.025,
      );
      (rungMaterial.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetBiomeColor,
        0.025,
      );

      // Reveal — DNA stays hidden at the top of the hero, then fades and
      // scales into place once the user has scrolled a little.
      const reveal = THREE.MathUtils.smoothstep(sp, 0.12, 0.55);
      strandMaterial.uniforms.uReveal.value = reveal;
      rungMaterial.uniforms.uReveal.value = reveal;
      dnaGroup.visible = reveal > 0.002;

      // Update shader uniforms — strandMaterial is shared by both strands
      strandMaterial.uniforms.uTime.value = t;
      strandMaterial.uniforms.uScrollProgress.value = sp;
      strandMaterial.uniforms.uMouse.value.copy(mouseNDC);
      strandMaterial.uniforms.uMouseStrength.value =
        Math.sqrt(mouseNDC.x * mouseNDC.x + mouseNDC.y * mouseNDC.y) < 1.5
          ? 1
          : 0;
      rungMaterial.uniforms.uTime.value = t;

      // Continuous spin shows the spiral winding through depth;
      // scroll velocity adds an extra kick of twist.
      dnaGroup.rotation.y += 0.004 + scrollVel * 0.0006;
      dnaGroup.rotation.x = 0.16 + mouseNDC.y * 0.12;
      dnaGroup.rotation.z = -mouseNDC.x * 0.05;

      // Rises and grows into place as it reveals
      dnaGroup.scale.setScalar(0.68 + reveal * 0.36);
      dnaGroup.position.y = (1.0 - reveal) * -1.4;

      renderer.render(scene, camera);
    }

    gsap.ticker.add(renderFrame);

    return () => {
      gsap.ticker.remove(renderFrame);
      window.removeEventListener("mousemove", onMouseMove);
      ro.disconnect();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
}
