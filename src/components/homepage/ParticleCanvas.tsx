"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ──────────────────────────────────────────────────────────────
   Global WebGL "soda bubble" Particle System
   A sparse field of billboard bubbles with 3D curl noise,
   biome color transitions, scroll-velocity physics,
   cursor repulsion, and comet trails.
   ────────────────────────────────────────────────────────────── */

interface ParticleCanvasProps {
  primaryColor: string;
  scrollVelocityRef?: React.MutableRefObject<number>;
}

function isCapable(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const hasWebGL2 = !!document.createElement("canvas").getContext("webgl2");
  return mem >= 4 && cores >= 4 && hasWebGL2;
}

// ── 3D Curl Noise (CPU) ─────────────────────────────────────
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise3(px: number, py: number, pz: number): number {
  const ix = Math.floor(px),
    iy = Math.floor(py),
    iz = Math.floor(pz);
  const fx = px - ix,
    fy = py - iy,
    fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash3(ix, iy, iz),
    b = hash3(ix + 1, iy, iz);
  const c = hash3(ix, iy + 1, iz),
    d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1),
    f = hash3(ix + 1, iy, iz + 1);
  const g = hash3(ix, iy + 1, iz + 1),
    h = hash3(ix + 1, iy + 1, iz + 1);

  const x1 = a + (b - a) * ux,
    x2 = c + (d - c) * ux;
  const x3 = e + (f - e) * ux,
    x4 = g + (h - g) * ux;
  const y1 = x1 + (x2 - x1) * uy,
    y2 = x3 + (x4 - x3) * uy;
  return y1 + (y2 - y1) * uz;
}

function curl3D(
  px: number,
  py: number,
  pz: number,
  t: number,
): { x: number; y: number; z: number } {
  const eps = 0.1;
  const t2 = t * 0.12;
  const n = (x: number, y: number, z: number) =>
    smoothNoise3(x + t2, y + t2, z + t2);

  const dny_dz = (n(px, py, pz + eps) - n(px, py, pz - eps)) / (2 * eps);
  const dnz_dy = (n(px, py + eps, pz) - n(px, py - eps, pz)) / (2 * eps);
  const dnz_dx = (n(px + eps, py, pz) - n(px - eps, py, pz)) / (2 * eps);
  const dnx_dz = (n(px, py, pz + eps) - n(px, py, pz - eps)) / (2 * eps);
  const dnx_dy = (n(px, py + eps, pz) - n(px, py - eps, pz)) / (2 * eps);
  const dny_dx = (n(px + eps, py, pz) - n(px - eps, py, pz)) / (2 * eps);

  return {
    x: dny_dz - dnz_dy,
    y: dnz_dx - dnx_dz,
    z: dnx_dy - dny_dx,
  };
}

// ── Comet system ─────────────────────────────────────────────
interface Comet {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export default function ParticleCanvas({
  primaryColor,
  scrollVelocityRef,
}: ParticleCanvasProps) {
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
    const PARTICLE_COUNT = capable ? 550 : 260;
    const SPREAD = 13;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    // ── Cursor tracking — bubbles part around the pointer ──
    const mouseNDC = new THREE.Vector2(0, 0);
    let mouseActive = false;
    function onMouseMove(e: MouseEvent) {
      mouseActive = true;
      mouseNDC.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    function onMouseLeave() {
      mouseActive = false;
    }
    window.addEventListener("mouseout", onMouseLeave, { passive: true });

    // ── Particles ──
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const opacities = new Float32Array(PARTICLE_COUNT);
    const velocities = new Float32Array(PARTICLE_COUNT * 3); // CPU-side

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * SPREAD;
      positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD * 0.7;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 9;
      sizes[i] = Math.random() * 2.4 + 0.8;
      opacities[i] = Math.random() * 0.4 + 0.08;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
    }

    const pGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute("position", posAttr);
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pGeo.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));

    const pMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uBiomeColor: { value: new THREE.Color(primaryColor) },
        uPixelRatio: { value: DPR },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aOpacity;
        uniform float uPixelRatio;
        varying float vOpacity;

        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          // Depth fade tuned to the camera distance (camera z = 10)
          float depthFade = smoothstep(-16.0, -5.0, mvPos.z);
          gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPos.z) * depthFade;
          gl_Position = projectionMatrix * mvPos;
          vOpacity = aOpacity * depthFade;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBiomeColor;
        varying float vOpacity;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;

          // Soft radial falloff — white core → biome color edge
          float t = 1.0 - d;
          vec3 col = mix(uBiomeColor, vec3(1.0), pow(t, 3.0) * 0.8);
          float alpha = pow(t, 1.6) * vOpacity * 0.6;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // ── Comet system (sparkle trails on scroll spikes) ──
    const comets: Comet[] = [];
    const cometGeo = new THREE.BufferGeometry();
    const MAX_COMETS = 60;
    const cometPositions = new Float32Array(MAX_COMETS * 3);
    const cometSizes = new Float32Array(MAX_COMETS);
    const cometAlphas = new Float32Array(MAX_COMETS);

    const cometPosAttr = new THREE.BufferAttribute(cometPositions, 3);
    cometPosAttr.setUsage(THREE.DynamicDrawUsage);
    cometGeo.setAttribute("position", cometPosAttr);
    const cometSizeAttr = new THREE.BufferAttribute(cometSizes, 1);
    cometSizeAttr.setUsage(THREE.DynamicDrawUsage);
    cometGeo.setAttribute("aSize", cometSizeAttr);
    const cometAlphaAttr = new THREE.BufferAttribute(cometAlphas, 1);
    cometAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    cometGeo.setAttribute("aAlpha", cometAlphaAttr);

    const cometMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uBiomeColor: { value: new THREE.Color(primaryColor) },
        uPixelRatio: { value: DPR },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (250.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBiomeColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv) * 2.0;
          if (d > 1.0) discard;
          float t = 1.0 - d;
          vec3 col = mix(uBiomeColor, vec3(1.0), pow(t, 2.0));
          float alpha = pow(t, 2.0) * vAlpha * 0.85;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const cometPoints = new THREE.Points(cometGeo, cometMat);
    scene.add(cometPoints);

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
    const targetColor = new THREE.Color(primaryColor);
    const halfX = SPREAD / 2;
    const halfY = (SPREAD * 0.7) / 2;
    const halfZ = 4.5;
    let lastVelocity = 0;
    let animId = 0;

    function spawnComets(vel: number) {
      const dir = vel > 0 ? 1 : -1;
      const count = Math.min(Math.floor(Math.abs(vel) * 2) + 2, 8);
      for (let i = 0; i < count; i++) {
        if (comets.length >= MAX_COMETS) break;
        comets.push({
          position: new THREE.Vector3(
            (Math.random() - 0.5) * SPREAD * 0.8,
            (Math.random() - 0.5) * SPREAD * 0.4,
            (Math.random() - 0.5) * 2,
          ),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            dir * (Math.random() * 0.8 + 0.4),
            (Math.random() - 0.5) * 0.1,
          ),
          life: 80,
          maxLife: 80,
        });
      }
    }

    function render(time: number) {
      animId = requestAnimationFrame(render);

      const t = time * 0.001;
      pMat.uniforms.uTime.value = t;

      // Lerp biome color
      targetColor.copy(biomeColorRef.current);
      (pMat.uniforms.uBiomeColor.value as THREE.Color).lerp(targetColor, 0.02);
      (cometMat.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetColor,
        0.02,
      );

      const scrollVel = scrollVelocityRef?.current ?? 0;

      // Spawn comets on velocity spikes
      if (
        Math.abs(scrollVel) > 1.5 &&
        Math.abs(scrollVel - lastVelocity) > 0.3
      ) {
        spawnComets(scrollVel);
      }
      lastVelocity = scrollVel;

      // Cursor position projected onto the particle plane (z ≈ 0)
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const halfW = halfH * camera.aspect;
      const mouseX = mouseNDC.x * halfW;
      const mouseY = mouseNDC.y * halfH;
      const REPEL_RADIUS = 2.4;

      // ── Update particles ──
      const pos = posAttr.array as Float32Array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3,
          iy = i * 3 + 1,
          iz = i * 3 + 2;
        const x = pos[ix],
          y = pos[iy],
          z = pos[iz];

        // Gentle 3D curl noise — a slow atmospheric drift, not a swarm
        const curl = curl3D(x * 0.25, y * 0.25, z * 0.25, t);
        velocities[ix] += curl.x * 0.00035;
        velocities[iy] += curl.y * 0.00035;
        velocities[iz] += curl.z * 0.0002;

        // Scroll push — the field blows past as you traverse the page
        velocities[iy] -= scrollVel * 0.0045;

        // Cursor repulsion — bubbles drift away from the pointer
        if (mouseActive) {
          const dx = x - mouseX;
          const dy = y - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < REPEL_RADIUS && dist > 0.0001) {
            const force = (1 - dist / REPEL_RADIUS) * 0.014;
            velocities[ix] += (dx / dist) * force;
            velocities[iy] += (dy / dist) * force;
          }
        }

        // Damping
        velocities[ix] *= 0.97;
        velocities[iy] *= 0.97;
        velocities[iz] *= 0.97;

        pos[ix] += velocities[ix];
        pos[iy] += velocities[iy];
        pos[iz] += velocities[iz];

        // Wrap
        if (pos[ix] > halfX) pos[ix] = -halfX;
        if (pos[ix] < -halfX) pos[ix] = halfX;
        if (pos[iy] > halfY) pos[iy] = -halfY;
        if (pos[iy] < -halfY) pos[iy] = halfY;
        if (pos[iz] > halfZ) pos[iz] = -halfZ;
        if (pos[iz] < -halfZ) pos[iz] = halfZ;
      }
      posAttr.needsUpdate = true;

      // ── Update comets ──
      let aliveCount = 0;
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.life--;
        if (c.life <= 0) {
          comets.splice(i, 1);
          continue;
        }
        c.position.add(c.velocity);
        c.velocity.multiplyScalar(0.97);

        const ci = aliveCount;
        cometPositions[ci * 3] = c.position.x;
        cometPositions[ci * 3 + 1] = c.position.y;
        cometPositions[ci * 3 + 2] = c.position.z;
        cometSizes[ci] = (c.life / c.maxLife) * 4 + 1;
        cometAlphas[ci] = c.life / c.maxLife;
        aliveCount++;
      }

      // Zero out unused slots
      for (let i = aliveCount; i < MAX_COMETS; i++) {
        cometPositions[i * 3] = 0;
        cometPositions[i * 3 + 1] = 999;
        cometPositions[i * 3 + 2] = 0;
        cometSizes[i] = 0;
        cometAlphas[i] = 0;
      }

      cometPosAttr.needsUpdate = true;
      cometSizeAttr.needsUpdate = true;
      cometAlphaAttr.needsUpdate = true;
      cometGeo.setDrawRange(0, aliveCount);

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
      cometGeo.dispose();
      cometMat.dispose();
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
