import * as THREE from "three";

const TWO_PI = Math.PI * 2;

/**
 * Procedural jellyfish geometry builder.
 *
 * A translucent pulsing bell with trailing tentacles, built entirely
 * in code (no model file). Shares the glassy additive aesthetic of
 * the DNA helix so it sits naturally in the OneWork hero/footer scenes.
 */

export interface JellyfishConfig {
  /** Bell radius */
  bellRadius: number;
  /** Number of trailing tentacles */
  tentacleCount: number;
  /** Tentacle length */
  tentacleLength: number;
}

const DEFAULT_CONFIG: JellyfishConfig = {
  bellRadius: 1,
  tentacleCount: 9,
  tentacleLength: 3.2,
};

/**
 * Creates the jellyfish Three.js group:
 * - A hemispherical bell that contracts/expands (swimming pulse)
 * - Trailing tentacle tubes with a per-tentacle wave
 *
 * Returns the group + materials for per-frame uniform updates.
 */
export function createJellyfishGroup(config: Partial<JellyfishConfig> = {}): {
  group: THREE.Group;
  bellMaterial: THREE.ShaderMaterial;
  tentacleMaterial: THREE.ShaderMaterial;
} {
  const c = { ...DEFAULT_CONFIG, ...config };
  const group = new THREE.Group();

  /* ── Bell ── */
  const bellMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uBiomeColor: { value: new THREE.Color("#3B82F6") },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vFresnel;
      varying float vRim;

      void main() {
        // Swimming pulse — bell contracts then relaxes
        float pulse = sin(uTime * 1.7) * 0.5 + 0.5;
        vec3 p = position;
        float squash = mix(1.0, 0.8, pulse);
        p.xz *= squash;
        p.y *= mix(1.0, 1.15, pulse);

        // Rim flares outward on contraction
        vRim = smoothstep(0.05, 0.0, p.y);
        p.xz *= 1.0 + vRim * pulse * 0.18;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 N = normalize(normalMatrix * normal);
        vec3 V = normalize(-mv.xyz);
        vFresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBiomeColor;
      varying float vFresnel;
      varying float vRim;

      void main() {
        vec3 col = mix(uBiomeColor, vec3(1.0), 0.3 + vFresnel * 0.55);
        col += uBiomeColor * vRim * 0.6;
        float alpha = 0.12 + vFresnel * 0.5 + vRim * 0.35;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  // Upper hemisphere dome
  const bellGeo = new THREE.SphereGeometry(
    c.bellRadius,
    40,
    24,
    0,
    TWO_PI,
    0,
    Math.PI / 2,
  );
  const bell = new THREE.Mesh(bellGeo, bellMaterial);
  group.add(bell);

  /* ── Tentacles ── */
  const tentacleMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBiomeColor: { value: new THREE.Color("#3B82F6") },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeed;
      varying float vDepth;

      void main() {
        vec3 p = position;
        // Depth below the bell — 0 at top, 1 at the tip
        float d = clamp(-p.y / ${c.tentacleLength.toFixed(1)}, 0.0, 1.0);
        vDepth = d;

        // Sway grows toward the tip
        float amp = d * 0.42;
        p.x += sin(p.y * 2.4 + uTime * 2.2 + aSeed) * amp;
        p.z += cos(p.y * 1.9 + uTime * 1.7 + aSeed) * amp;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBiomeColor;
      varying float vDepth;

      void main() {
        vec3 col = mix(vec3(1.0), uBiomeColor, vDepth);
        float alpha = (1.0 - vDepth) * 0.5 + 0.06;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  for (let i = 0; i < c.tentacleCount; i++) {
    const angle = (i / c.tentacleCount) * TWO_PI;
    const ringRadius = c.bellRadius * 0.78;
    const ox = Math.cos(angle) * ringRadius;
    const oz = Math.sin(angle) * ringRadius;

    const points: THREE.Vector3[] = [];
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = -t * c.tentacleLength;
      // Gentle inward curl toward the axis as the tentacle descends
      const curl = 1 - t * 0.35;
      points.push(new THREE.Vector3(ox * curl, y, oz * curl));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, steps, 0.022, 5, false);

    // Per-tentacle wave seed
    const seedArr = new Float32Array(geo.attributes.position.count);
    seedArr.fill(angle * 1.3 + i);
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seedArr, 1));

    group.add(new THREE.Mesh(geo, tentacleMaterial));
  }

  return { group, bellMaterial, tentacleMaterial };
}
