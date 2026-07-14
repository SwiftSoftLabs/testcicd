"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ──────────────────────────────────────────────────────────────
   Generative WebGL Background
   A slow-drifting fbm "nebula" fullscreen shader tinted by the
   active biome color. Replaces a background video — no assets,
   fully brand-controlled, GPU-cheap (one fullscreen quad).
   ────────────────────────────────────────────────────────────── */

interface SceneBackgroundProps {
  primaryColor: string;
}

export default function SceneBackground({
  primaryColor,
}: SceneBackgroundProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biomeColorRef = useRef(new THREE.Color(primaryColor));

  useEffect(() => {
    biomeColorRef.current.set(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    const mount = mountRef.current;
    if (typeof window === "undefined" || !mount) return;
    if (!document.createElement("canvas").getContext("webgl2")) return;

    const W = mount.clientWidth;
    const H = mount.clientHeight;
    const DPR = Math.min(window.devicePixelRatio, 1);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uBiomeColor: { value: new THREE.Color(primaryColor) },
        uResolution: { value: new THREE.Vector2(W, H) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uBiomeColor;
        uniform vec2 uResolution;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float amp = 0.55;
          for (int i = 0; i < 5; i++) {
            v += amp * noise(p);
            p *= 2.02;
            amp *= 0.5;
          }
          return v;
        }

        void main() {
          // Aspect-correct uv centred on screen
          vec2 uv = vUv;
          float aspect = uResolution.x / max(uResolution.y, 1.0);
          vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

          float t = uTime * 0.02;
          // Two drifting fbm layers for slow volumetric motion
          float n1 = fbm(p * 2.2 + vec2(t, t * 0.6));
          float n2 = fbm(p * 4.0 - vec2(t * 0.7, t));
          float clouds = n1 * 0.65 + n2 * 0.35;

          // Vignette so the centre stays dark for content legibility
          float vig = 1.0 - smoothstep(0.25, 1.05, length(p));

          vec3 deep = vec3(0.015, 0.022, 0.04);
          vec3 glow = uBiomeColor;
          float intensity = pow(clouds, 2.4) * vig * 0.5;

          vec3 col = deep + glow * intensity;
          float alpha = 0.55 + intensity * 0.45;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      material.uniforms.uResolution.value.set(w, h);
    });
    ro.observe(mount);

    const targetColor = new THREE.Color(primaryColor);
    let animId = 0;

    function render(time: number) {
      animId = requestAnimationFrame(render);
      material.uniforms.uTime.value = time * 0.001;
      targetColor.copy(biomeColorRef.current);
      (material.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetColor,
        0.02,
      );
      renderer.render(scene, camera);
    }
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      quad.geometry.dispose();
      material.dispose();
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
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
