"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createJellyfishGroup } from "@/lib/jellyfish";

/* ──────────────────────────────────────────────────────────────
   Jellyfish Scene
   A procedural jellyfish that slowly drifts across the viewport —
   upward in the hero, downward in contact. WebGL2-gated with a
   silent no-op fallback.
   ────────────────────────────────────────────────────────────── */

interface JellyfishSceneProps {
  biomePrimary: string;
  direction?: "up" | "down";
}

function isCapable(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const hasWebGL2 = !!document.createElement("canvas").getContext("webgl2");
  return mem >= 4 && cores >= 4 && hasWebGL2;
}

export default function JellyfishScene({
  biomePrimary,
  direction = "up",
}: JellyfishSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biomeColorRef = useRef(new THREE.Color(biomePrimary));

  useEffect(() => {
    biomeColorRef.current.set(biomePrimary);
  }, [biomePrimary]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !isCapable()) return;

    const W = mount.clientWidth;
    const H = mount.clientHeight;
    const DPR = Math.min(window.devicePixelRatio, 1.5);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);

    const { group, bellMaterial, tentacleMaterial } = createJellyfishGroup();

    // Swimming downward → flip so the bell leads and tentacles trail up
    if (direction === "down") group.rotation.z = Math.PI;

    group.position.x = 3.2;
    group.scale.setScalar(0.92);
    scene.add(group);

    const mouseNDC = new THREE.Vector2(0, 0);
    function onMouseMove(e: MouseEvent) {
      mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const targetColor = new THREE.Color(biomePrimary);
    const dir = direction === "up" ? 1 : -1;
    const Y_RANGE = 9;
    let yPos = -dir * Y_RANGE; // start off the leading edge
    let animId = 0;

    function render(time: number) {
      animId = requestAnimationFrame(render);
      const t = time * 0.001;

      targetColor.copy(biomeColorRef.current);
      (bellMaterial.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetColor,
        0.03,
      );
      (tentacleMaterial.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetColor,
        0.03,
      );
      bellMaterial.uniforms.uTime.value = t;
      tentacleMaterial.uniforms.uTime.value = t;

      // Slow vertical drift, wrapping when it leaves the viewport
      yPos += dir * 0.012;
      if (dir > 0 && yPos > Y_RANGE) yPos = -Y_RANGE;
      if (dir < 0 && yPos < -Y_RANGE) yPos = Y_RANGE;
      group.position.y = yPos;
      group.position.x = 3.2 + Math.sin(t * 0.35) * 0.6;

      // Gentle drift + a subtle lean toward the cursor
      group.rotation.y = t * 0.25;
      const baseTilt = direction === "down" ? Math.PI : 0;
      group.rotation.z = baseTilt + Math.sin(t * 0.5) * 0.12 + mouseNDC.x * 0.1;

      renderer.render(scene, camera);
    }
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      ro.disconnect();
      bellMaterial.dispose();
      tentacleMaterial.dispose();
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
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
