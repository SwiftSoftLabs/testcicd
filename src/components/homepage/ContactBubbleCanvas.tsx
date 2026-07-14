"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ──────────────────────────────────────────────────────────────
   Contact soda bubble field (inverted hero)
   Bubbles spawn along the top edge and drift slowly downward.
   ────────────────────────────────────────────────────────────── */

interface ContactBubbleCanvasProps {
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
  topY: number,
  topBand: number,
) {
  positions[i * 3] = (Math.random() - 0.5) * halfW * 2;
  positions[i * 3 + 1] = topY - Math.random() * topBand;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
  sizes[i] = Math.random() * 1.1 + 0.35;
  phases[i] = Math.random() * Math.PI * 2;
}

export default function ContactBubbleCanvas({
  primaryColor,
}: ContactBubbleCanvasProps) {
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
    const BUBBLE_COUNT = capable ? 380 : 190;
    const Y_RANGE = 9;
    const topY = Y_RANGE;
    const bottomY = -Y_RANGE;
    const halfW = 7.2;
    const INIT_TOP_BAND = 2.8;
    const RESPAWN_TOP_BAND = 0.45;
    const FALL_SPEED_MIN = 0.0045;
    const FALL_SPEED_RANGE = 0.0055;

    const randomFallSpeed = () =>
      FALL_SPEED_MIN + Math.random() * FALL_SPEED_RANGE;

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
    camera.position.set(0, 0, 12);

    const positions = new Float32Array(BUBBLE_COUNT * 3);
    const sizes = new Float32Array(BUBBLE_COUNT);
    const phases = new Float32Array(BUBBLE_COUNT);
    const fallSpeeds = new Float32Array(BUBBLE_COUNT);
    const wobbleSpeeds = new Float32Array(BUBBLE_COUNT);

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      spawnBubble(
        positions,
        sizes,
        phases,
        i,
        halfW,
        topY,
        INIT_TOP_BAND,
      );
      fallSpeeds[i] = randomFallSpeed();
      wobbleSpeeds[i] = 0.35 + Math.random() * 0.55;
    }

    const pGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute("position", posAttr);
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

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
        uniform float uPixelRatio;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (72.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBiomeColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;

          float rim = step(0.86, d) * (1.0 - step(0.98, d));
          vec2 hlUv = uv - vec2(-0.1, 0.12);
          float highlight = step(length(hlUv) * 2.8, 0.22);
          float alpha = rim * 0.7 + highlight * 0.45;
          vec3 col = mix(uBiomeColor, vec3(1.0), highlight * 0.9 + rim * 0.25);
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
    let animId = 0;

    function render(time: number) {
      animId = requestAnimationFrame(render);
      const t = time * 0.001;

      targetColor.copy(biomeColorRef.current);
      (pMat.uniforms.uBiomeColor.value as THREE.Color).lerp(targetColor, 0.03);

      const pos = posAttr.array as Float32Array;
      for (let i = 0; i < BUBBLE_COUNT; i++) {
        const ix = i * 3;
        const iy = i * 3 + 1;
        const phase = phases[i];

        pos[ix] += Math.sin(t * wobbleSpeeds[i] + phase) * 0.0009;
        pos[iy] -= fallSpeeds[i];

        if (pos[iy] < bottomY) {
          spawnBubble(
            pos,
            sizes,
            phases,
            i,
            halfW,
            topY,
            RESPAWN_TOP_BAND,
          );
          fallSpeeds[i] = randomFallSpeed();
        }
      }
      posAttr.needsUpdate = true;

      renderer.render(scene, camera);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
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
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
}
