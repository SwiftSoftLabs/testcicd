"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { gsap } from "gsap";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const MODEL_PATH = "/models/dna/";
const NAVY_BASE = "#2a4588";
const NAVY_EMISSIVE = "#3a5ca8";
const DOT_EMISSIVE = "#d8f0ff";
const BUMP_SCALE = 0.38;
const DOT_EMISSIVE_INTENSITY = 1.05;
const BASE_EMISSIVE_INTENSITY = 0.14;
const GRAIN_SHININESS = 20;
const DNA_TEXTURE_ALIASES: Record<string, string> = {
  "dna_displace.png": "DNA_displace.png",
  "diffuse_noise.png": "Diffuse_Noise.png",
  "dots_mask.png": "Dots_mask.png",
};
const AUTO_SPEED = 0.25;
const DRAG_SENSITIVITY = 0.005;
const INERTIA_DAMPING = 0.92;
const VELOCITY_EPSILON = 0.0008;
const DRAG_THRESHOLD_PX = 4;
const DESKTOP_DRAG_MQ = "(min-width: 1024px)";
const TILT_X = 0.22;
const ROT_X_CLAMP = Math.PI * 0.45;

type InteractionMode = "auto" | "drag" | "inertia";

function isCapableDevice(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const hasWebGL2 = !!canvas.getContext("webgl2");
  const hasWebGL1 = !!canvas.getContext("webgl");
  return hasWebGL2 || hasWebGL1;
}

const MODEL_TARGET_HEIGHT = 3.85;
const CAMERA_FRAME_PADDING = 1.1;

function normalizeModel(object: THREE.Object3D, targetHeight = MODEL_TARGET_HEIGHT) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = targetHeight / maxDim;
  object.scale.setScalar(scale);
}

function frameCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  padding = CAMERA_FRAME_PADDING,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const vFovRad = THREE.MathUtils.degToRad(camera.fov);
  const halfHeight = Math.max(size.y / 2, 0.001);

  // Fill the section's vertical extent; width may extend past the sides.
  const dist = (halfHeight * padding) / Math.tan(vFovRad / 2);

  camera.position.set(center.x, center.y, center.z + dist);
  camera.near = Math.max(0.01, dist / 100);
  camera.far = Math.max(100, dist * 20);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
}

function configureSurfaceTexture(texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

function styleDnaMaterials(object: THREE.Object3D) {
  const base = new THREE.Color(NAVY_BASE);
  const navyEmissive = new THREE.Color(NAVY_EMISSIVE);
  const dotEmissive = new THREE.Color(DOT_EMISSIVE);
  const matteSpecular = new THREE.Color(0x0a1020);
  const grainSpecular = new THREE.Color(0x5a72a0);

  object.traverse((child) => {
    const meshLike = child as THREE.Object3D & {
      isMesh?: boolean;
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (!meshLike.isMesh) return;
    if (meshLike.geometry && !meshLike.geometry.getAttribute("normal")) {
      meshLike.geometry.computeVertexNormals();
    }
    if (!meshLike.material) {
      meshLike.material = new THREE.MeshPhongMaterial({
        color: base,
        emissive: navyEmissive,
        emissiveIntensity: BASE_EMISSIVE_INTENSITY,
        specular: matteSpecular,
        shininess: 10,
        side: THREE.DoubleSide,
      });
      return;
    }
    const mats = Array.isArray(meshLike.material)
      ? meshLike.material
      : [meshLike.material];
    mats.forEach((mat) => {
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial
      ) {
        mat.color.copy(base);
        mat.map = null;
        mat.alphaMap = null;
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
        mat.side = THREE.DoubleSide;

        if (mat.emissiveMap) {
          mat.emissive.copy(dotEmissive);
          mat.emissiveIntensity = DOT_EMISSIVE_INTENSITY;
          configureSurfaceTexture(mat.emissiveMap);
        } else {
          mat.emissive.copy(navyEmissive);
          mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY;
        }

        if (mat.bumpMap) {
          configureSurfaceTexture(mat.bumpMap);
          mat.bumpScale = BUMP_SCALE;
        }

        if (mat instanceof THREE.MeshPhongMaterial) {
          if (mat.specularMap) {
            mat.specular.copy(grainSpecular);
            mat.shininess = GRAIN_SHININESS;
            configureSurfaceTexture(mat.specularMap);
          } else {
            mat.specular.copy(matteSpecular);
            mat.shininess = 14;
          }
        } else {
          mat.metalness = 0;
          mat.roughness = 0.9;
          if ("envMapIntensity" in mat) {
            (mat as THREE.MeshStandardMaterial).envMapIntensity = 0.2;
          }
        }
        mat.needsUpdate = true;
      }
    });
  });
}

function createFallbackHelixGroup() {
  const group = new THREE.Group();
  const strandMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2DE2D1"),
    emissive: new THREE.Color("#14B8A6"),
    emissiveIntensity: 0.8,
    metalness: 0.1,
    roughness: 0.3,
  });
  const rungMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#A7FFF4"),
    emissive: new THREE.Color("#2DD4BF"),
    emissiveIntensity: 0.35,
    metalness: 0.08,
    roughness: 0.35,
  });

  const pointsA: THREE.Vector3[] = [];
  const pointsB: THREE.Vector3[] = [];
  const turns = 2.6;
  const height = 4.2;
  const radius = 0.62;
  const segments = 180;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * Math.PI * 2 * turns;
    const y = (t - 0.5) * height;
    pointsA.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    pointsB.push(
      new THREE.Vector3(
        Math.cos(angle + Math.PI) * radius,
        y,
        Math.sin(angle + Math.PI) * radius,
      ),
    );
  }

  const curveA = new THREE.CatmullRomCurve3(pointsA);
  const curveB = new THREE.CatmullRomCurve3(pointsB);
  const strandA = new THREE.Mesh(
    new THREE.TubeGeometry(curveA, segments, 0.04, 10, false),
    strandMaterial,
  );
  const strandB = new THREE.Mesh(
    new THREE.TubeGeometry(curveB, segments, 0.04, 10, false),
    strandMaterial.clone(),
  );
  group.add(strandA, strandB);

  const rungGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 8, 1);
  rungGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const a = curveA.getPointAt(t);
    const b = curveB.getPointAt(t);
    const rung = new THREE.Mesh(rungGeo, rungMaterial.clone());
    rung.position.copy(a.clone().add(b).multiplyScalar(0.5));
    rung.scale.set(a.distanceTo(b), 1, 1);
    rung.lookAt(b);
    group.add(rung);
  }

  return group;
}

function hasMeshDescendants(object: THREE.Object3D) {
  let meshCount = 0;
  object.traverse((child) => {
    if ((child as THREE.Object3D & { isMesh?: boolean }).isMesh) meshCount += 1;
  });
  return meshCount > 0;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const meshLike = child as THREE.Object3D & {
      isMesh?: boolean;
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (meshLike.isMesh && meshLike.geometry && meshLike.material) {
      meshLike.geometry.dispose();
      const mats = Array.isArray(meshLike.material)
        ? meshLike.material
        : [meshLike.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

function createModelLoadingManager() {
  const loadingManager = new THREE.LoadingManager();
  loadingManager.setURLModifier((url) => {
    if (!url) return url;
    if (/^(data:|blob:|https?:)/i.test(url)) return url;

    const normalized = url.replace(/\\/g, "/");
    if (normalized.startsWith("/")) return normalized;

    const fileName = decodeURIComponent(normalized.split("/").pop() ?? normalized);
    const mappedName = DNA_TEXTURE_ALIASES[fileName.toLowerCase()] ?? fileName;
    return `${MODEL_PATH}${mappedName}`;
  });
  return loadingManager;
}

type DnaTextureSet = {
  grain?: THREE.Texture;
  dots?: THREE.Texture;
  bump?: THREE.Texture;
};

async function loadDnaTextures(
  textureLoader: THREE.TextureLoader,
  onLoaded: (texture: THREE.Texture) => void,
): Promise<DnaTextureSet> {
  const loadOptional = async (
    name: string,
    colorSpace: THREE.ColorSpace,
  ) => {
    try {
      const texture = await textureLoader.loadAsync(name);
      texture.colorSpace = colorSpace;
      configureSurfaceTexture(texture);
      onLoaded(texture);
      return texture;
    } catch {
      return undefined;
    }
  };

  return {
    grain: await loadOptional("Diffuse_Noise.png", THREE.SRGBColorSpace),
    dots: await loadOptional("Dots_mask.png", THREE.SRGBColorSpace),
    bump: await loadOptional("DNA_displace.png", THREE.NoColorSpace),
  };
}

function applyDnaTextureMaps(object: THREE.Object3D, textures: DnaTextureSet) {
  object.traverse((child) => {
    const meshLike = child as THREE.Object3D & {
      isMesh?: boolean;
      material?: THREE.Material | THREE.Material[];
    };
    if (!meshLike.isMesh || !meshLike.material) return;
    const mats = Array.isArray(meshLike.material)
      ? meshLike.material
      : [meshLike.material];

    mats.forEach((mat) => {
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshPhysicalMaterial
      ) {
        mat.map = null;
        mat.alphaMap = null;
        mat.transparent = false;
        mat.opacity = 1;

        if (textures.grain) {
          if (mat instanceof THREE.MeshPhongMaterial) {
            mat.specularMap = textures.grain;
            configureSurfaceTexture(mat.specularMap);
          } else if (mat instanceof THREE.MeshStandardMaterial) {
            mat.roughnessMap = textures.grain;
            mat.roughness = 0.88;
            configureSurfaceTexture(mat.roughnessMap);
          }
        }
        if (textures.dots) {
          mat.emissiveMap = textures.dots;
          configureSurfaceTexture(mat.emissiveMap);
        }
        if (textures.bump) {
          mat.bumpMap = textures.bump;
          configureSurfaceTexture(mat.bumpMap);
          mat.bumpScale = BUMP_SCALE;
        }

        mat.needsUpdate = true;
      }
    });
  });
}

type HowItWorksDnaCanvasProps = {
  sectionRef: RefObject<HTMLElement | null>;
};

export default function HowItWorksDnaCanvas({
  sectionRef,
}: HowItWorksDnaCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebgl(isCapableDevice());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || webgl !== true) return;

    let disposed = false;
    const DPR = Math.min(window.devicePixelRatio, 1.5);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(DPR);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.15, 5.8);
    camera.lookAt(0, 0, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.24;

    const dnaGroup = new THREE.Group();
    scene.add(dnaGroup);
    let loadedModel = false;
    let framedObject: THREE.Object3D | null = null;
    const loadedTextures: THREE.Texture[] = [];

    const ambient = new THREE.AmbientLight(0x8a9ec8, 0.58);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xe8eef8, 1.18);
    keyLight.position.set(3.5, 4, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x4a5f8a, 0.52);
    fillLight.position.set(-4, -0.5, 3);
    scene.add(fillLight);
    const backLight = new THREE.DirectionalLight(0x3a5080, 0.38);
    backLight.position.set(0, -2, -4);
    scene.add(backLight);
    const rimLight = new THREE.DirectionalLight(0x7a6ec8, 0.42);
    rimLight.position.set(-3, 2.5, -4);
    scene.add(rimLight);

    let mode: InteractionMode = reduceMotion ? "inertia" : "auto";
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let dragDistance = 0;
    let velY = 0;
    let velX = 0;
    let lastPointerTime = performance.now();
    const velocitySamples: { vx: number; vy: number }[] = [];

    const desktopDragMq = window.matchMedia(DESKTOP_DRAG_MQ);
    let dragEnabled = desktopDragMq.matches;

    function applyDragEnabled(enabled: boolean) {
      dragEnabled = enabled;
      renderer.domElement.style.touchAction = enabled ? "none" : "pan-y";
      renderer.domElement.style.cursor = enabled ? "grab" : "default";
      if (!enabled && isDragging) {
        isDragging = false;
        velX = 0;
        velY = 0;
        mode = reduceMotion ? "inertia" : "auto";
        velocitySamples.length = 0;
      }
    }

    applyDragEnabled(dragEnabled);

    dnaGroup.rotation.x = TILT_X;

    const mountFallbackHelix = () => {
      if (disposed || loadedModel) return;
      const fallback = createFallbackHelixGroup();
      normalizeModel(fallback);
      dnaGroup.add(fallback);
      framedObject = fallback;
      frameCameraToObject(camera, fallback);
      loadedModel = true;
    };

    const loadingManager = createModelLoadingManager();
    const objLoader = new OBJLoader(loadingManager);
    objLoader.setPath(MODEL_PATH);
    const mtlLoader = new MTLLoader(loadingManager);
    mtlLoader.setPath(MODEL_PATH);
    mtlLoader.setResourcePath(MODEL_PATH);
    mtlLoader.setMaterialOptions({ side: THREE.DoubleSide });
    const textureLoader = new THREE.TextureLoader(loadingManager);
    textureLoader.setPath(MODEL_PATH);

    const applyLoadedObject = (object: THREE.Group, textures: DnaTextureSet) => {
      if (disposed) return;
      if (!hasMeshDescendants(object)) {
        mountFallbackHelix();
        return;
      }
      dnaGroup.clear();
      normalizeModel(object);
      applyDnaTextureMaps(object, textures);
      styleDnaMaterials(object);
      dnaGroup.add(object);
      framedObject = object;
      frameCameraToObject(camera, object);
      loadedModel = true;
    };

    const loadModel = async () => {
      const textures = await loadDnaTextures(textureLoader, (texture) => {
        loadedTextures.push(texture);
      });
      let materials: unknown;
      try {
        const loadedMaterials = await mtlLoader.loadAsync("DNA_002.mtl");
        if (disposed) return;
        loadedMaterials.preload();
        materials = loadedMaterials;
      } catch {
        materials = undefined;
      }

      try {
        if (materials) objLoader.setMaterials(materials as never);
        const object = await objLoader.loadAsync("DNA_002.obj");
        applyLoadedObject(object, textures);
        return;
      } catch {
        if (disposed) return;
      }

      if (!materials) {
        mountFallbackHelix();
        return;
      }

      try {
        const fallbackObjLoader = new OBJLoader(loadingManager);
        fallbackObjLoader.setPath(MODEL_PATH);
        const object = await fallbackObjLoader.loadAsync("DNA_002.obj");
        applyLoadedObject(object, textures);
      } catch {
        if (disposed) return;
        mountFallbackHelix();
      }
    };

    void loadModel();

    const onDesktopDragMqChange = (e: MediaQueryListEvent) => {
      applyDragEnabled(e.matches);
    };
    desktopDragMq.addEventListener("change", onDesktopDragMqChange);

    function resize() {
      const section = sectionRef.current;
      const w = section?.clientWidth ?? mount?.clientWidth ?? 0;
      const h = section?.clientHeight ?? mount?.clientHeight ?? 0;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (framedObject) frameCameraToObject(camera, framedObject);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(sectionRef.current ?? mount);

    function recordVelocity(deltaX: number, deltaY: number, dt: number) {
      if (dt <= 0) return;
      velocitySamples.push({
        vx: (deltaY * DRAG_SENSITIVITY) / dt,
        vy: (deltaX * DRAG_SENSITIVITY) / dt,
      });
      if (velocitySamples.length > 3) velocitySamples.shift();
    }

    function averageVelocity() {
      if (velocitySamples.length === 0) return { vx: 0, vy: 0 };
      let vx = 0;
      let vy = 0;
      for (const s of velocitySamples) {
        vx += s.vx;
        vy += s.vy;
      }
      const n = velocitySamples.length;
      return { vx: vx / n, vy: vy / n };
    }

    function onPointerDown(e: PointerEvent) {
      if (!dragEnabled || e.button !== 0) return;
      isDragging = true;
      mode = "drag";
      dragDistance = 0;
      velocitySamples.length = 0;
      velX = 0;
      velY = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      const deltaX = e.clientX - lastX;
      const deltaY = e.clientY - lastY;
      dragDistance += Math.hypot(deltaX, deltaY);
      const now = performance.now();
      const dt = Math.max((now - lastPointerTime) / 1000, 0.001);
      lastPointerTime = now;

      dnaGroup.rotation.y += deltaX * DRAG_SENSITIVITY;
      dnaGroup.rotation.x = THREE.MathUtils.clamp(
        dnaGroup.rotation.x + deltaY * DRAG_SENSITIVITY,
        -ROT_X_CLAMP,
        ROT_X_CLAMP,
      );

      if (dragDistance >= DRAG_THRESHOLD_PX) {
        recordVelocity(deltaX, deltaY, dt);
      }

      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!isDragging) return;
      isDragging = false;
      renderer.domElement.releasePointerCapture(e.pointerId);
      renderer.domElement.style.cursor = "grab";

      if (dragDistance >= DRAG_THRESHOLD_PX && !reduceMotion) {
        const avg = averageVelocity();
        velY = avg.vy;
        velX = avg.vx;
        mode = "inertia";
      } else {
        velY = 0;
        velX = 0;
        mode = "inertia";
      }
      lastPointerTime = performance.now();
      velocitySamples.length = 0;
    }

    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    function renderFrame(_time: number, deltaTime: number) {
      const dt = Math.min(deltaTime, 0.05);

      if (!reduceMotion) {
        if (mode === "auto") {
          dnaGroup.rotation.y += AUTO_SPEED * dt;
        } else if (mode === "inertia") {
          dnaGroup.rotation.y += velY * dt;
          dnaGroup.rotation.x = THREE.MathUtils.clamp(
            dnaGroup.rotation.x + velX * dt,
            -ROT_X_CLAMP,
            ROT_X_CLAMP,
          );
          velY *= INERTIA_DAMPING;
          velX *= INERTIA_DAMPING;
          if (
            Math.abs(velY) < VELOCITY_EPSILON &&
            Math.abs(velX) < VELOCITY_EPSILON
          ) {
            velY = 0;
            velX = 0;
            mode = "auto";
          }
        }
      }

      renderer.render(scene, camera);
    }

    gsap.ticker.add(renderFrame);

    return () => {
      disposed = true;
      gsap.ticker.remove(renderFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      ro.disconnect();
      desktopDragMq.removeEventListener("change", onDesktopDragMqChange);
      disposeObject(dnaGroup);
      loadedTextures.forEach((texture) => texture.dispose());
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [webgl, reduceMotion, sectionRef]);

  if (webgl !== true) return null;

  return (
    <div
      ref={mountRef}
      className="pointer-events-none lg:pointer-events-auto absolute inset-0 z-[2] h-full w-full"
      style={{ opacity: 0.96 }}
      aria-hidden="true"
    />
  );
}
