import * as THREE from "three";

const TWO_PI = Math.PI * 2;

/**
 * DNA Double-Helix geometry builder.
 *
 * Two helical phosphate-backbone strands intertwined with
 * cross-connecting base-pair "rungs". Represents collaborative
 * work in OneWork — two strands joining to form something whole.
 */

export interface DNAHelixConfig {
  /** Helix radius (strand distance from center axis) */
  radius: number;
  /** Total vertical height of the helix */
  height: number;
  /** Number of full turns */
  turns: number;
  /** Points sampled per strand */
  strandSegments: number;
  /** Tube thickness of each strand */
  tubeRadius: number;
  /** Number of base-pair rungs */
  rungCount: number;
}

const DEFAULT_CONFIG: DNAHelixConfig = {
  radius: 0.6,
  height: 8,
  turns: 3,
  strandSegments: 256,
  tubeRadius: 0.018,
  rungCount: 40,
};

/**
 * Builds the two helical backbone strands as CatmullRom curves.
 * Strand B is offset by π from Strand A (opposite side of helix).
 */
export function buildDNAStrands(config: Partial<DNAHelixConfig> = {}): {
  strandA: THREE.CatmullRomCurve3;
  strandB: THREE.CatmullRomCurve3;
} {
  const c = { ...DEFAULT_CONFIG, ...config };
  const pointsA: THREE.Vector3[] = [];
  const pointsB: THREE.Vector3[] = [];

  for (let i = 0; i <= c.strandSegments; i++) {
    const t = i / c.strandSegments;
    const angle = t * TWO_PI * c.turns;
    const y = (t - 0.5) * c.height; // centered vertically

    // Strand A
    pointsA.push(
      new THREE.Vector3(
        c.radius * Math.cos(angle),
        y,
        c.radius * Math.sin(angle),
      ),
    );

    // Strand B — offset by π
    pointsB.push(
      new THREE.Vector3(
        c.radius * Math.cos(angle + Math.PI),
        y,
        c.radius * Math.sin(angle + Math.PI),
      ),
    );
  }

  return {
    strandA: new THREE.CatmullRomCurve3(pointsA, false, "catmullrom", 0.5),
    strandB: new THREE.CatmullRomCurve3(pointsB, false, "catmullrom", 0.5),
  };
}

/**
 * Returns positions for base-pair rungs connecting the two strands.
 * Each rung is a pair of endpoints (pointOnA, pointOnB).
 */
export function buildDNARungs(
  config: Partial<DNAHelixConfig> = {},
): { start: THREE.Vector3; end: THREE.Vector3 }[] {
  const c = { ...DEFAULT_CONFIG, ...config };
  const rungs: { start: THREE.Vector3; end: THREE.Vector3 }[] = [];

  for (let i = 0; i < c.rungCount; i++) {
    const t = (i + 0.5) / c.rungCount; // evenly spaced
    const angle = t * TWO_PI * c.turns;
    const y = (t - 0.5) * c.height;

    const ax = c.radius * Math.cos(angle);
    const az = c.radius * Math.sin(angle);
    const bx = c.radius * Math.cos(angle + Math.PI);
    const bz = c.radius * Math.sin(angle + Math.PI);

    rungs.push({
      start: new THREE.Vector3(ax, y, az),
      end: new THREE.Vector3(bx, y, bz),
    });
  }

  return rungs;
}

/**
 * Creates the complete DNA helix Three.js group:
 * - Two tube meshes for the backbone strands
 * - Cylinder meshes for each base-pair rung
 *
 * Returns the group + arrays for per-frame uniform updates.
 */
export function createDNAHelixGroup(config: Partial<DNAHelixConfig> = {}): {
  group: THREE.Group;
  strandMeshA: THREE.Mesh;
  strandMeshB: THREE.Mesh;
  rungMeshes: THREE.Mesh[];
  strandMaterial: THREE.ShaderMaterial;
  rungMaterial: THREE.ShaderMaterial;
} {
  const c = { ...DEFAULT_CONFIG, ...config };
  const { strandA, strandB } = buildDNAStrands(c);
  const rungs = buildDNARungs(c);

  const group = new THREE.Group();

  // ── Strand shader material ──
  const strandMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBiomeColor: { value: new THREE.Color("#4B8BFF") },
      uScrollProgress: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseStrength: { value: 0 },
      uReveal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uMouseStrength;
      varying float vProgress;
      varying float vFresnel;
      varying float vShimmer;
      varying float vViewZ;

      // Simplified curl noise displacement
      vec3 curlDisplace(vec3 p, float t) {
        float s = sin(p.y * 2.0 + t * 1.5) * 0.022;
        float c = cos(p.y * 1.5 + t * 0.8) * 0.016;
        return vec3(s, 0.0, c);
      }

      void main() {
        vProgress = clamp((position.y + 3.5) / 7.0, 0.0, 1.0);

        vec3 displaced = position + curlDisplace(position, uTime);

        // Mouse proximity displacement — compared in normalized device coords
        vec4 clip0 = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        vec2 ndc = clip0.xy / max(clip0.w, 0.0001);
        float influence = smoothstep(0.55, 0.0, length(ndc - uMouse)) * uMouseStrength;
        displaced += normalize(position) * influence * 0.35;

        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vViewZ = mv.z;
        vec3 N = normalize(normalMatrix * normal);
        vec3 V = normalize(-mv.xyz);
        vFresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vShimmer = sin(vProgress * 40.0 - uTime * 2.6);

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBiomeColor;
      uniform float uScrollProgress;
      uniform float uReveal;
      varying float vProgress;
      varying float vFresnel;
      varying float vShimmer;
      varying float vViewZ;

      void main() {
        float shimmer = vShimmer * 0.12 + 0.88;

        // Glassy base — biome color with a bright fresnel rim
        vec3 col = mix(uBiomeColor, vec3(1.0), 0.35 + vFresnel * 0.5) * shimmer;

        // Traveling glow pulse that climbs the helix with scroll + time
        float head = fract(uScrollProgress + uTime * 0.05);
        float pulse = exp(-pow((vProgress - head) * 6.0, 2.0));
        col += uBiomeColor * pulse * 0.85;

        // Depth cue — the strand winding away from camera dims, so the
        // double helix reads as a real 3D spiral, not a flat ribbon.
        float depthDim = smoothstep(-13.0, -3.0, vViewZ);
        col *= 0.28 + 0.72 * depthDim;

        float alpha = (0.32 + vFresnel * 0.5) * shimmer + pulse * 0.4;
        alpha *= (0.32 + 0.68 * depthDim) * uReveal;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  // ── Build strand tubes ──
  const tubeGeoA = new THREE.TubeGeometry(
    strandA,
    c.strandSegments,
    c.tubeRadius,
    6,
    false,
  );
  const tubeGeoB = new THREE.TubeGeometry(
    strandB,
    c.strandSegments,
    c.tubeRadius,
    6,
    false,
  );

  // Both strands share one material — identical look, single uniform update
  const strandMeshA = new THREE.Mesh(tubeGeoA, strandMaterial);
  const strandMeshB = new THREE.Mesh(tubeGeoB, strandMaterial);

  group.add(strandMeshA);
  group.add(strandMeshB);

  // ── Rung shader material ──
  const rungMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBiomeColor: { value: new THREE.Color("#4B8BFF") },
      uReveal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBiomeColor;
      uniform float uReveal;
      varying float vViewZ;

      void main() {
        float pulse = sin(uTime * 2.5 + vViewZ * 1.5) * 0.2 + 0.8;
        // Far base-pairs dim → the rung ladder reads with 3D depth
        float depthDim = smoothstep(-13.0, -3.0, vViewZ);
        vec3 col = mix(uBiomeColor, vec3(1.0), 0.35) * pulse * (0.3 + 0.7 * depthDim);
        float alpha = 0.5 * pulse * (0.32 + 0.68 * depthDim) * uReveal;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  // ── Build rungs as thin cylinders ──
  const rungMeshes: THREE.Mesh[] = [];
  const rungGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1);
  // Rotate so cylinder axis is along X (we'll orient each rung individually)
  rungGeo.rotateZ(Math.PI / 2);

  for (const rung of rungs) {
    const mesh = new THREE.Mesh(rungGeo, rungMaterial);
    const midpoint = new THREE.Vector3()
      .addVectors(rung.start, rung.end)
      .multiplyScalar(0.5);
    const length = rung.start.distanceTo(rung.end);

    mesh.position.copy(midpoint);
    mesh.scale.set(length, 1, 1);
    mesh.lookAt(rung.end);

    rungMeshes.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    strandMeshA,
    strandMeshB,
    rungMeshes,
    strandMaterial,
    rungMaterial,
  };
}

/**
 * Returns the 3-D position on the DNA helix for a scroll progress in [0, 1].
 * Follows strand A's path.
 */
export function getDNAHelixPoint(
  progress: number,
  config: Partial<DNAHelixConfig> = {},
): THREE.Vector3 {
  const c = { ...DEFAULT_CONFIG, ...config };
  const angle = progress * TWO_PI * c.turns;
  const y = (progress - 0.5) * c.height;
  return new THREE.Vector3(
    c.radius * Math.cos(angle),
    y,
    c.radius * Math.sin(angle),
  );
}
