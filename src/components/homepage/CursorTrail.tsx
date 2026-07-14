"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ──────────────────────────────────────────────────────────────
   WebGL Cursor Trail + Ripple
   A fixed full-viewport overlay (pointer-events: none) that draws
   a fading additive trail chasing the pointer, plus a soft ripple
   ring spawned on fast movement. Disabled on touch / coarse
   pointers so it never interferes with mobile.
   ────────────────────────────────────────────────────────────── */

interface CursorTrailProps {
  primaryColor: string;
}

const TRAIL_LENGTH = 26;
const MAX_RIPPLES = 8;

export default function CursorTrail({ primaryColor }: CursorTrailProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const biomeColorRef = useRef(new THREE.Color(primaryColor));

  useEffect(() => {
    biomeColorRef.current.set(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    const mount = mountRef.current;
    if (typeof window === "undefined" || !mount) return;
    // Fine-pointer only — skip on touch devices
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (!document.createElement("canvas").getContext("webgl2")) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    const DPR = Math.min(window.devicePixelRatio, 1.5);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    let aspect = W / H;
    const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0, 10);
    camera.position.z = 5;

    /* ── Pointer state ── */
    const target = new THREE.Vector2(0, 0);
    const lastTarget = new THREE.Vector2(0, 0);
    let pointerSeen = false;

    function toScene(clientX: number, clientY: number) {
      target.set(((clientX / W) * 2 - 1) * aspect, -((clientY / H) * 2 - 1));
    }
    function onMove(e: MouseEvent) {
      pointerSeen = true;
      toScene(e.clientX, e.clientY);
    }
    window.addEventListener("mousemove", onMove, { passive: true });

    /* ── Trail (chain of points) ── */
    const trail: THREE.Vector2[] = [];
    for (let i = 0; i < TRAIL_LENGTH; i++) trail.push(new THREE.Vector2(0, 0));

    const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    const trailSizes = new Float32Array(TRAIL_LENGTH);
    const trailAlphas = new Float32Array(TRAIL_LENGTH);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const f = 1 - i / TRAIL_LENGTH;
      trailSizes[i] = f * f * 26 + 3;
      trailAlphas[i] = f * f;
    }

    const trailGeo = new THREE.BufferGeometry();
    const trailPosAttr = new THREE.BufferAttribute(trailPositions, 3);
    trailPosAttr.setUsage(THREE.DynamicDrawUsage);
    trailGeo.setAttribute("position", trailPosAttr);
    trailGeo.setAttribute("aSize", new THREE.BufferAttribute(trailSizes, 1));
    trailGeo.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlphas, 1));

    const trailMat = new THREE.ShaderMaterial({
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
          vAlpha = aAlpha;
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
          vec3 col = mix(uBiomeColor, vec3(1.0), pow(t, 3.0));
          gl_FragColor = vec4(col, pow(t, 1.8) * vAlpha * 0.7);
        }
      `,
    });

    const trailPoints = new THREE.Points(trailGeo, trailMat);
    trailPoints.frustumCulled = false;
    scene.add(trailPoints);

    /* ── Ripple rings ── */
    interface Ripple {
      mesh: THREE.Mesh;
      mat: THREE.ShaderMaterial;
      life: number;
      active: boolean;
    }
    const ripples: Ripple[] = [];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          uBiomeColor: { value: new THREE.Color(primaryColor) },
          uProgress: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uBiomeColor;
          uniform float uProgress;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            // Thin ring band that widens and fades as it expands
            float ring = smoothstep(0.86, 0.94, d) * (1.0 - smoothstep(0.94, 1.0, d));
            float fade = 1.0 - uProgress;
            float alpha = ring * fade * fade * 0.6;
            gl_FragColor = vec4(mix(uBiomeColor, vec3(1.0), 0.4), alpha);
          }
        `,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      ripples.push({ mesh, mat, life: 0, active: false });
    }

    function spawnRipple(x: number, y: number) {
      const r = ripples.find((rp) => !rp.active);
      if (!r) return;
      r.active = true;
      r.life = 0;
      r.mesh.visible = true;
      r.mesh.position.set(x, y, 0);
    }

    /* ── Resize ── */
    function onResize() {
      W = window.innerWidth;
      H = window.innerHeight;
      aspect = W / H;
      camera.left = -aspect;
      camera.right = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    }
    window.addEventListener("resize", onResize);

    /* ── Render loop ── */
    const targetColor = new THREE.Color(primaryColor);
    let rippleCooldown = 0;
    let animId = 0;

    function render() {
      animId = requestAnimationFrame(render);

      targetColor.copy(biomeColorRef.current);
      (trailMat.uniforms.uBiomeColor.value as THREE.Color).lerp(
        targetColor,
        0.04,
      );

      // Head eases toward pointer; each link chases the previous one
      trail[0].lerp(target, 0.35);
      for (let i = 1; i < TRAIL_LENGTH; i++) {
        trail[i].lerp(trail[i - 1], 0.42);
        trailPositions[i * 3] = trail[i].x;
        trailPositions[i * 3 + 1] = trail[i].y;
        trailPositions[i * 3 + 2] = 0;
      }
      trailPositions[0] = trail[0].x;
      trailPositions[1] = trail[0].y;
      trailPositions[2] = 0;
      trailPosAttr.needsUpdate = true;

      // Spawn a ripple on a fast flick of the pointer
      const speed = lastTarget.distanceTo(target);
      lastTarget.copy(target);
      rippleCooldown -= 1;
      if (pointerSeen && speed > 0.16 && rippleCooldown <= 0) {
        spawnRipple(target.x, target.y);
        rippleCooldown = 14;
      }

      // Advance ripples
      for (const r of ripples) {
        if (!r.active) continue;
        r.life += 1;
        const progress = r.life / 48;
        if (progress >= 1) {
          r.active = false;
          r.mesh.visible = false;
          continue;
        }
        r.mat.uniforms.uProgress.value = progress;
        (r.mat.uniforms.uBiomeColor.value as THREE.Color).copy(targetColor);
        const scale = 0.08 + progress * 0.7;
        r.mesh.scale.set(scale, scale, 1);
      }

      renderer.render(scene, camera);
    }
    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
      trailGeo.dispose();
      trailMat.dispose();
      for (const r of ripples) {
        r.mesh.geometry.dispose();
        r.mat.dispose();
      }
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
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 60 }}
    />
  );
}
