import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const params = new URLSearchParams(window.location.search);
const $ = (id) => document.getElementById(id);
if (params.has("clean")) document.body.classList.add("clean");

const stage = $("stageWrap");
const canvas = $("stage");
const loader = $("loader");
const errorPanel = $("error");
const spinBtn = $("spinBtn");
const spinLabel = $("spinLabel");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
} catch (error) {
  console.error(error);
  showError();
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x050506, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.70;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050506);

const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
const CAMERA_START = new THREE.Vector3(0.255, 0.505, 0.98);
const CAMERA_TARGET = new THREE.Vector3(0.0, 0.225, 0.015);
camera.position.copy(CAMERA_START);
camera.lookAt(CAMERA_TARGET);

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment(renderer);
const envTexture = pmrem.fromScene(room, 0.04).texture;
scene.environment = envTexture;
pmrem.dispose();
room.dispose?.();

const hemi = new THREE.HemisphereLight(0xfff5e6, 0x180b06, 0.22);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfffaf5, 1.15);
key.position.set(-1.15, 2.35, 1.6);
scene.add(key);

const fill = new THREE.DirectionalLight(0xb9d2ff, 0.40);
fill.position.set(1.5, 0.9, -0.8);
scene.add(fill);

const goldRim = new THREE.PointLight(0xff8391, 0.85, 2.6, 2.0);
goldRim.position.set(0.72, 1.08, -0.65);
scene.add(goldRim);

const warmFront = new THREE.PointLight(0xffb0b6, 0.28, 2.2, 2.0);
warmFront.position.set(-0.35, 0.60, 1.05);
scene.add(warmFront);

function radialTexture(inner, mid, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(256, 256, 2, 256, 256, 255);
  g.addColorStop(0, inner);
  g.addColorStop(0.28, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A quiet warm halo behind the cluster.
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: radialTexture("rgba(109, 22, 32, 0.21)", "rgba(55, 16, 23, 0.07)", "rgba(0, 0, 0, 0)"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    opacity: 0.9,
  })
);
halo.position.set(0.0, 0.22, -1.05);
halo.scale.set(1.55, 1.12, 1);
halo.renderOrder = -5;
scene.add(halo);

const bouquet = new THREE.Group();
bouquet.name = "rose-cluster";
scene.add(bouquet);

let autoSpin = params.get("still") !== "1";
let rotation = THREE.MathUtils.degToRad(parseFloat(params.get("a") || "-7"));
if (!Number.isFinite(rotation)) rotation = 0;
bouquet.rotation.y = rotation;

let goldMaterial = null;
let firstFrame = true;

spinBtn?.addEventListener("click", () => {
  autoSpin = !autoSpin;
  spinBtn.setAttribute("aria-pressed", String(autoSpin));
  if (spinLabel) spinLabel.textContent = autoSpin ? "PAUSE MOTION" : "RESUME MOTION";
});
spinBtn?.setAttribute("aria-pressed", String(autoSpin));
if (spinLabel) spinLabel.textContent = autoSpin ? "PAUSE MOTION" : "RESUME MOTION";

function showError(error) {
  console.error(error);
  loader?.classList.add("is-done");
  if (errorPanel) errorPanel.hidden = false;
}

async function boot() {
  const textureLoader = new THREE.TextureLoader();
  let normalMap;
  let baseMap;
  try {
    [normalMap, baseMap] = await Promise.all([
      textureLoader.loadAsync("./assets/rose_normal.png"),
      textureLoader.loadAsync("./assets/rose_basecolor.png"),
    ]);
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    baseMap.colorSpace = THREE.SRGBColorSpace;
    baseMap.wrapS = baseMap.wrapT = THREE.RepeatWrapping;
    baseMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  } catch (error) {
    console.warn("texture load failed; falling back to solid petals", error);
    normalMap = null;
    baseMap = null;
  }

  const petalMaterials = {
    Pastel_Rose_Inner: new THREE.MeshPhysicalMaterial({
      color: 0x3f050c,
      normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 0.36,
      metalness: 0.0,
      clearcoat: 0.82,
      clearcoatRoughness: 0.10,
      sheen: 0.82,
      sheenColor: new THREE.Color(0xffd1dc),
      sheenRoughness: 0.35,
      emissive: new THREE.Color(0x180104),
      emissiveIntensity: 0.20,
      envMapIntensity: 0.80,
    }),
    Pastel_Rose_Mid: new THREE.MeshPhysicalMaterial({
      color: 0x590812,
      normalMap,
      normalScale: new THREE.Vector2(0.44, 0.44),
      roughness: 0.33,
      metalness: 0.0,
      clearcoat: 0.86,
      clearcoatRoughness: 0.09,
      sheen: 0.86,
      sheenColor: new THREE.Color(0xffd1dc),
      sheenRoughness: 0.33,
      emissive: new THREE.Color(0x1d0205),
      emissiveIntensity: 0.22,
      envMapIntensity: 0.86,
    }),
    Pastel_Rose_Outer: new THREE.MeshPhysicalMaterial({
      color: 0x7c101c,
      normalMap,
      normalScale: new THREE.Vector2(0.46, 0.46),
      roughness: 0.29,
      metalness: 0.0,
      clearcoat: 0.90,
      clearcoatRoughness: 0.08,
      sheen: 0.90,
      sheenColor: new THREE.Color(0xffd6e0),
      sheenRoughness: 0.31,
      emissive: new THREE.Color(0x220206),
      emissiveIntensity: 0.24,
      envMapIntensity: 0.94,
    }),
  };

  const leafMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x3c6a31,
    roughness: 0.48,
    metalness: 0.0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.16,
    sheen: 0.24,
    sheenColor: new THREE.Color(0xb1985c),
    sheenRoughness: 0.52,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    envMapIntensity: 0.82,
  });
  const stemMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x285126,
    roughness: 0.50,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    sheen: 0.18,
    sheenColor: new THREE.Color(0x9e8b57),
    sheenRoughness: 0.55,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
    envMapIntensity: 0.72,
  });
  const veinMaterial = new THREE.MeshStandardMaterial({
    color: 0xc89a4f,
    metalness: 0.52,
    roughness: 0.34,
    emissive: new THREE.Color(0x1c0f03),
    emissiveIntensity: 0.24,
    envMapIntensity: 1.0,
  });
  const calyxMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x203119,
    roughness: 0.34,
    metalness: 0.03,
    clearcoat: 0.6,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xc39a55),
    sheenRoughness: 0.4,
    envMapIntensity: 1.0,
  });

  const materialFor = (name) => {
    if (petalMaterials[name]) return petalMaterials[name];
    if (name === "Pastel_Leaf") return leafMaterial;
    if (name === "Pastel_Stem") return stemMaterial;
    if (name === "Pastel_Vein") return veinMaterial;
    if (name === "Pastel_Calyx") return calyxMaterial;
    return null;
  };

  const gltfLoader = new GLTFLoader();
  let gltf;
  try {
    gltf = await gltfLoader.loadAsync("./assets/rose_cluster.glb");
  } catch (error) {
    showError(error);
    return;
  }
  const model = gltf.scene;
  model.name = "rose-cluster-source";
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const next = materials.map((m) => {
      const replacement = materialFor(m?.name);
      return replacement || m;
    });
    child.material = Array.isArray(child.material) ? next : next[0];
    child.castShadow = false;
    child.receiveShadow = false;
  });
  bouquet.add(model);

  // Gold dust.
  let gold = null;
  try {
    const response = await fetch("./assets/gold_particles.json");
    if (!response.ok) throw new Error("gold data missing");
    gold = await response.json();
  } catch (error) {
    console.warn("gold dust unavailable", error);
  }
  if (gold?.count) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(gold.position, 3));
    geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(gold.color, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(gold.size, 1));
    geometry.setAttribute("aAlpha", new THREE.Float32BufferAttribute(gold.alpha, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(gold.phase, 1));
    goldMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * 0.55 + aPhase;
          p += vec3(sin(t * 1.3), cos(t * 0.9), sin(t * 0.7)) * 0.0018;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.52 + 0.48 * pow(0.5 + 0.5 * sin(uTime * 2.0 + aPhase), 2.2);
          gl_PointSize = aSize * uPixelRatio * (0.50 / max(0.18, -mv.z)) * (0.82 + 0.26 * twinkle);
          vColor = aColor;
          vAlpha = aAlpha * (0.42 + 0.58 * twinkle);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float core = 1.0 - smoothstep(0.0, 0.045, d2);
          float halo = 1.0 - smoothstep(0.01, 0.25, d2);
          vec3 col = mix(vColor, vec3(1.0, 0.93, 0.75), core * 0.50);
          gl_FragColor = vec4(col, (core * 0.82 + halo * 0.42) * vAlpha);
        }
      `,
    });
    const points = new THREE.Points(geometry, goldMaterial);
    points.frustumCulled = false;
    points.renderOrder = 4;
    bouquet.add(points);
  }

  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.17,
    0.44,
    0.92
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const clock = new THREE.Clock();
  function resize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (goldMaterial) goldMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  window.addEventListener("resize", resize);
  resize();

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    if (autoSpin) {
      rotation += delta * 0.105;
      bouquet.rotation.y = rotation;
    }
    bouquet.position.y = 0.006 * Math.sin(clock.elapsedTime * 0.38);
    if (goldMaterial) {
      goldMaterial.uniforms.uTime.value = clock.elapsedTime;
    }
    composer.render(delta);
    if (firstFrame) {
      firstFrame = false;
      loader?.classList.add("is-done");
      window.__rosesReady = true;
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  window.__roses = {
    scene,
    camera,
    composer,
    bouquet,
    setRotation: (degrees) => {
      rotation = THREE.MathUtils.degToRad(degrees);
      bouquet.rotation.y = rotation;
    },
    setAuto: (v) => {
      autoSpin = !!v;
      spinBtn?.setAttribute("aria-pressed", String(autoSpin));
      if (spinLabel) spinLabel.textContent = autoSpin ? "PAUSE MOTION" : "RESUME MOTION";
    },
    get ready() { return window.__rosesReady === true; },
  };
}

boot().catch(showError);
