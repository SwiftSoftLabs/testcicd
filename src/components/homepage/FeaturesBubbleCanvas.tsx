"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ──────────────────────────────────────────────────────────────
   Features soda bubble field
   Bubbles spawn along the bottom, drift upward into the overlap
   toward the How section, then pop before respawning.
   ────────────────────────────────────────────────────────────── */

interface FeaturesBubbleCanvasProps {
  primaryColor: string;
}

function isCapable(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const hasWebGL2 = !!document.createElement("canvas").getContext("webgl2");
  return mem >= 4 && cores >= 4 && hasWebGL2;
}

function spawnBubble(
  positions: Float32Array,
  sizes: Float32Array,
  phases: Float32Array,
  i: number,
  halfW: number,
  bottomY: number,
  bottomBand: number,
) {
  positions[i * 3] = (Math.random() - 0.5) * halfW * 2;
  positions[i * 3 + 1] = bottomY + Math.random() * bottomBand;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
  sizes[i] = Math.random() * 1.1 + 0.35;
  phases[i] = Math.random() * Math.PI * 2;
}

export default function FeaturesBubbleCanvas({
  primaryColor,
}: FeaturesBubbleCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biomeColorRef = useRef(new THREE.Color(primaryColor));

  useEffect(() => {
    biomeColorRef.current.set(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const capable = isCapable();

    const W = mount.clientWidth;
    const H = mount.clientHeight;
    const DPR = Math.min(window.devicePixelRatio, capable ? 1.5 : 1);
    const BUBBLE_COUNT = capable ? 780 : 390;
    const Y_RANGE = 13;
    const bottomY = -Y_RANGE * 0.55;
    const popY = Y_RANGE * 0.92;
    const halfW = 7.2;
    const INIT_BOTTOM_BAND = 4;
    const RESPAWN_BOTTOM_BAND = 0.45;
    const RISE_SPEED_MIN = 0.004;
    const RISE_SPEED_RANGE = 0.005;
    const POP_DURATION = 0.38;

    const randomRiseSpeed = () =>
      RISE_SPEED_MIN + Math.random() * RISE_SPEED_RANGE;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 1.2, 12);

    const positions = new Float32Array(BUBBLE_COUNT * 3);
    const sizes = new Float32Array(BUBBLE_COUNT);
    const phases = new Float32Array(BUBBLE_COUNT);
    const popProgress = new Float32Array(BUBBLE_COUNT);
    const riseSpeeds = new Float32Array(BUBBLE_COUNT);
    const wobbleSpeeds = new Float32Array(BUBBLE_COUNT);

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      spawnBubble(
        positions,
        sizes,
        phases,
        i,
        halfW,
        bottomY,
        INIT_BOTTOM_BAND,
      );
      riseSpeeds[i] = randomRiseSpeed();
      wobbleSpeeds[i] = 0.35 + Math.random() * 0.55;
    }

    const pGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute("position", posAttr);
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    pGeo.setAttribute(
      "aPop",
      new THREE.BufferAttribute(popProgress, 1),
    );

    const pMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      uniforms: {
        uBiomeColor: { value: new THREE.Color(primaryColor) },
        uPixelRatio: { value: DPR },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aPop;
        varying float vPop;
        uniform float uPixelRatio;
        void main() {
          vPop = aPop;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float popScale = 1.0 + aPop * 2.8;
          gl_PointSize = aSize * popScale * uPixelRatio * (72.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBiomeColor;
        varying float vPop;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float pop = clamp(vPop, 0.0, 1.0);
          float d = length(uv) * 2.0 / (1.0 + pop * 1.15);
          if (d > 1.0 + pop * 0.35) discard;

          float rim = step(0.86, d) * (1.0 - step(0.98, d));
          vec2 hlUv = uv - vec2(-0.1, 0.12);
          float highlight = step(length(hlUv) * 2.8, 0.22);
          float fade = 1.0 - pop * 0.92;
          float burst = smoothstep(0.25, 0.55, pop) * (1.0 - smoothstep(0.75, 1.0, pop));
          float alpha =
            (rim * 0.7 + highlight * 0.45) * fade +
            burst * rim * 1.4;
          vec3 col = mix(
            uBiomeColor,
            vec3(1.0),
            highlight * 0.9 * fade + rim * 0.25 + burst * 0.5
          );
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const targetColor = new THREE.Color(primaryColor);
    const popAttr = pGeo.getAttribute("aPop") as THREE.BufferAttribute;
    const halfH = Y_RANGE * 0.68;
    const REPEL_RADIUS = 2.5;
    let mouseActive = false;
    let mouseX = 0;
    let mouseY = 0;

    function onMouseMove(e: MouseEvent) {
      if (!mount) return;
      const rect = mount.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        mouseActive = false;
        return;
      }
      mouseActive = true;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseX = ndcX * halfW;
      mouseY = ndcY * halfH + camera.position.y;
    }

    function onMouseLeave() {
      mouseActive = false;
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseout", onMouseLeave, { passive: true });

    let animId = 0;
    let lastTime = 0;

    function render(time: number) {
      animId = requestAnimationFrame(render);
      const dt = lastTime ? Math.min((time - lastTime) * 0.001, 0.05) : 0.016;
      lastTime = time;
      const t = time * 0.001;

      targetColor.copy(biomeColorRef.current);
      (pMat.uniforms.uBiomeColor.value as THREE.Color).lerp(targetColor, 0.03);

      const pos = posAttr.array as Float32Array;
      const pops = popAttr.array as Float32Array;

      for (let i = 0; i < BUBBLE_COUNT; i++) {
        const ix = i * 3;
        const iy = i * 3 + 1;
        const phase = phases[i];

        if (pops[i] > 0) {
          pops[i] = Math.min(1, pops[i] + dt / POP_DURATION);
          if (pops[i] >= 1) {
            spawnBubble(
              pos,
              sizes,
              phases,
              i,
              halfW,
              bottomY,
              RESPAWN_BOTTOM_BAND,
            );
            riseSpeeds[i] = randomRiseSpeed();
            pops[i] = 0;
          }
          continue;
        }

        pos[ix] += Math.sin(t * wobbleSpeeds[i] + phase) * 0.0009;
        pos[iy] += riseSpeeds[i];

        if (mouseActive) {
          const dx = pos[ix] - mouseX;
          const dy = pos[iy] - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < REPEL_RADIUS && dist > 0.0001) {
            const force = (1 - dist / REPEL_RADIUS) * 0.024;
            pos[ix] += (dx / dist) * force;
            pos[iy] += (dy / dist) * force;
          }
        }

        if (pos[iy] >= popY) {
          pops[i] = 0.001;
        }
      }
      posAttr.needsUpdate = true;
      popAttr.needsUpdate = true;

      renderer.render(scene, camera);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseout", onMouseLeave);
      ro.disconnect();
      pGeo.dispose();
      pMat.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="absolute left-0 right-0 bottom-0 w-full pointer-events-none"
      style={{
        zIndex: 1,
        top: "-min(32vh, 300px)",
        height: "calc(100% + min(32vh, 300px))",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, #000 18%, #000 88%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, #000 18%, #000 88%, transparent 100%)",
      }}
    />
  );
}
