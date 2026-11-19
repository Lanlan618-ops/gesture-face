import * as THREE from "./assets/vendor/three.module.js";

const $ = (id) => document.getElementById(id);
const elements = {
  canvas: $("stage"),
  gate: $("gate"),
  startBtn: $("startBtn"),
  autoBtn: $("autoBtn"),
  pointerBtn: $("pointerBtn"),
  gateMessage: $("gateMessage"),
  statusChip: $("statusChip"),
  statusText: $("statusText"),
  dispersionValue: $("dispersionValue"),
  meterFill: $("meterFill"),
  meterMarker: $("meterMarker"),
  stateText: $("stateText"),
  stageHint: $("stageHint"),
  cameraCard: $("cameraCard"),
  cameraIdleText: $("cameraIdleText"),
  cameraBadge: $("cameraBadge"),
  cameraMode: $("cameraMode"),
  webcam: $("webcam"),
  handCanvas: $("handCanvas"),
  footerMode: $("footerMode"),
  demoModeBtn: $("demoModeBtn"),
  fullscreenBtn: $("fullscreenBtn"),
  toast: $("toast"),
  particleCount: $("particleCount")
};

const state = {
  mode: "gate",
  entered: false,
  webgl: true,
  ready: false,
  targetDispersion: 0,
  dispersion: 0,
  handPresent: false,
  handSeenOnce: false,
  lastHandAt: 0,
  starting: false,
  pointerBound: false,
  autoClock: 0,
  particleCount: 0,
  lastHudUpdate: 0,
  lastHudPercent: -1,
  toastTimer: 0
};

const params = new URLSearchParams(location.search);
const COOL = 0xcfeef7;
const COOL_DIM = 0x8eb9c7;

/* -----------------------------------------------------------------------
   WebGL scene
------------------------------------------------------------------------ */

let renderer;
let scene;
let camera;
let root;
let floorGroup;
let sweepLine;
let dust;
let plane;
let points;
let planeUniforms;
let particleUniforms;
let clock;
let sceneReadyResolve;
const sceneReady = new Promise((resolve) => { sceneReadyResolve = resolve; });

const CUBE_W = 3.55;
const CUBE_H = 4.35;
const CUBE_D = 2.45;
const PLANE_H = 3.95;
const PLANE_W = PLANE_H * (833 / 1050);

function initThree() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: elements.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
  } catch (error) {
    state.webgl = false;
    console.error("WebGL unavailable", error);
    return;
  }

  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0.5, 1.15, window.innerWidth < 1180 ? 14.35 : 13.4);
  camera.lookAt(0, 0.1, 0);

  root = new THREE.Group();
  root.position.y = 0.18;
  scene.add(root);

  buildCube();
  buildFloor();
  buildDust();

  clock = new THREE.Clock();
  loadSubject();

  window.addEventListener("resize", onResize);
}

function buildCube() {
  const cube = new THREE.Group();
  cube.name = "bounding-cube";
  root.add(cube);

  const hx = CUBE_W / 2;
  const hy = CUBE_H / 2;
  const hz = CUBE_D / 2;
  const corners = [
    [-hx, -hy, -hz], [ hx, -hy, -hz], [ hx,  hy, -hz], [-hx,  hy, -hz],
    [-hx, -hy,  hz], [ hx, -hy,  hz], [ hx,  hy,  hz], [-hx,  hy,  hz]
  ].map((p) => new THREE.Vector3(...p));

  const edgePairs = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7]
  ];

  const lineMaterial = new THREE.MeshBasicMaterial({
    color: COOL,
    transparent: true,
    opacity: 0.88,
    depthWrite: false
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x92d9ea,
    transparent: true,
    opacity: 0.035,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const up = new THREE.Vector3(0, 1, 0);
  for (const [a, b] of edgePairs) {
    const start = corners[a];
    const end = corners[b];
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());

    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0044, 0.0044, length, 5, 1, false),
      lineMaterial
    );
    line.position.copy(midpoint);
    line.quaternion.copy(quaternion);
    cube.add(line);

    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, length, 5, 1, false),
      glowMaterial
    );
    glow.position.copy(midpoint);
    glow.quaternion.copy(quaternion);
    cube.add(glow);
  }

  const dotTexture = makeRadialTexture("rgba(255,255,255,1)", "rgba(190,240,250,.5)", "rgba(120,190,210,0)");
  for (const corner of corners) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture,
      color: 0xcdeff7,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    halo.position.copy(corner);
    halo.scale.set(0.19, 0.19, 1);
    cube.add(halo);

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture,
      color: 0xf5fdff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    core.position.copy(corner);
    core.scale.set(0.083, 0.083, 1);
    cube.add(core);
  }
}

function makeRadialTexture(inner, mid, outer) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.32, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function buildFloor() {
  floorGroup = new THREE.Group();
  floorGroup.position.y = -2.72;
  scene.add(floorGroup);

  const ringMaterial = new THREE.LineBasicMaterial({
    color: 0x7eb6c8,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  for (const radius of [0.9, 1.5, 2.15, 2.85]) {
    const pts = [];
    for (let i = 0; i <= 160; i += 1) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius * 0.38));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    floorGroup.add(new THREE.LineLoop(geom, ringMaterial));
  }

  const spokes = [];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    spokes.push(new THREE.Vector3(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7 * 0.38));
    spokes.push(new THREE.Vector3(Math.cos(a) * 2.85, 0, Math.sin(a) * 2.85 * 0.38));
  }
  const spokeGeom = new THREE.BufferGeometry().setFromPoints(spokes);
  floorGroup.add(new THREE.LineSegments(spokeGeom, new THREE.LineBasicMaterial({
    color: 0x5e93a5,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })));

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 512; glowCanvas.height = 256;
  const gtx = glowCanvas.getContext("2d");
  const grd = gtx.createRadialGradient(256, 128, 4, 256, 128, 250);
  grd.addColorStop(0, "rgba(118,197,220,.34)");
  grd.addColorStop(0.35, "rgba(80,151,175,.12)");
  grd.addColorStop(1, "rgba(20,50,62,0)");
  gtx.fillStyle = grd;
  gtx.fillRect(0, 0, 512, 256);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.NoColorSpace;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 3.6),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.01;
  floorGroup.add(glow);

  const sweepGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(2.85, 0, 0)
  ]);
  sweepLine = new THREE.Line(sweepGeom, new THREE.LineBasicMaterial({
    color: 0xbcebf5,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  floorGroup.add(sweepLine);
}

function buildDust() {
  const count = 100;
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rng = mulberry32(1907);
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = (rng() - 0.5) * 10;
    pos[i * 3 + 1] = (rng() - 0.5) * 7;
    pos[i * 3 + 2] = (rng() - 0.5) * 4 - 1;
    const v = 0.35 + rng() * 0.5;
    colors[i * 3] = v * 0.9;
    colors[i * 3 + 1] = v * 0.94;
    colors[i * 3 + 2] = v;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.015,
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  dust = new THREE.Points(geom, mat);
  scene.add(dust);
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法载入全息人物素材"));
    img.src = url;
  });
}

async function loadSubject() {
  let img;
  try {
    img = await loadImage("./assets/hologram.png");
  } catch (error) {
    console.error(error);
    setGateMessage("全息人物素材载入失败，请刷新页面。", "error");
    sceneReadyResolve();
    return;
  }

  // Texture for the intact hologram plane.
  const texCanvas = document.createElement("canvas");
  texCanvas.width = img.naturalWidth;
  texCanvas.height = img.naturalHeight;
  const texCtx = texCanvas.getContext("2d");
  texCtx.drawImage(img, 0, 0);
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  planeUniforms = {
    uMap: { value: texture },
    uDisperse: { value: 0 },
    uTime: { value: 0 },
    uScan: { value: 0.5 },
    uRim: { value: new THREE.Color(0xa8e3f0) },
    uOpacity: { value: 0.92 }
  };

  const planeGeometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const planeMaterial = new THREE.ShaderMaterial({
    uniforms: planeUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform float uDisperse;
      uniform float uTime;
      uniform float uScan;
      uniform vec3 uRim;
      uniform float uOpacity;
      varying vec2 vUv;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.52;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.03 + 17.1;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.012) discard;

        float n = fbm(vUv * vec2(9.0, 7.0) + vec2(uTime * 0.018, -uTime * 0.012));
        float threshold = uDisperse * 0.75 - 0.22;
        float breakup = smoothstep(0.0, 0.18, n - threshold);

        vec3 col = tex.rgb;
        float scan = 0.968 + 0.032 * sin(vUv.y * 420.0 - uTime * 2.2);
        col *= scan;

        float e = 1.7 / 900.0;
        float aL = texture2D(uMap, vUv - vec2(e, 0.0)).a;
        float aR = texture2D(uMap, vUv + vec2(e, 0.0)).a;
        float aB = texture2D(uMap, vUv - vec2(0.0, e)).a;
        float aT = texture2D(uMap, vUv + vec2(0.0, e)).a;
        float edge = clamp(tex.a - min(min(aL, aR), min(aB, aT)), 0.0, 1.0);
        edge = smoothstep(0.0, 0.28, edge);
        col += uRim * edge * 0.5;

        float band = exp(-pow((vUv.y - uScan) / 0.038, 2.0));
        col += uRim * edge * band * 0.85;

        float alpha = tex.a * uOpacity;
        alpha *= mix(1.0, breakup, smoothstep(0.0, 0.44, uDisperse));
        alpha *= 1.0 - smoothstep(0.15, 0.84, uDisperse);
        gl_FragColor = vec4(col, alpha);
      }
    `
  });

  plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.position.set(0, 0.1, 0.02);
  plane.renderOrder = 2;
  root.add(plane);

  buildParticles(img);
  sceneReadyResolve();
  state.ready = true;
  if (params.has("demo")) enterAuto({ skipGate: true });
  else if (params.has("pointer")) enterPointer({ skipGate: true });
  if (params.has("dispersion")) {
    const v = Number(params.get("dispersion"));
    if (Number.isFinite(v)) {
      state.targetDispersion = THREE.MathUtils.clamp(v, 0, 1);
      state.dispersion = state.targetDispersion;
    }
  }
}

function buildParticles(img) {
  const sw = 166;
  const sh = Math.max(1, Math.round(sw * img.height / img.width));
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, sw, sh);
  const pixels = ctx.getImageData(0, 0, sw, sh).data;

  const homes = [];
  const targets = [];
  const colors = [];
  const sizes = [];
  const delays = [];
  const seeds = [];
  const alphas = [];

  const rng = mulberry32(9271);
  const halfW = CUBE_W * 0.44;
  const halfH = CUBE_H * 0.46;
  const halfD = CUBE_D * 0.43;

  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const i = (y * sw + x) * 4;
      const a = pixels[i + 3] / 255;
      if (a < 0.13) continue;
      if (rng() < 0.1) continue;
      const u = (x + 0.5) / sw;
      const v = (y + 0.5) / sh;
      homes.push((u - 0.5) * PLANE_W, (0.5 - v) * PLANE_H, (rng() - 0.5) * 0.05);

      // Keep a loose memory of where each colour came from. Most particles
      // expand locally; a smaller share drifts into the far corners.
      const hx = (u - 0.5) * PLANE_W;
      const hy = (0.5 - v) * PLANE_H;
      let tx;
      let ty;
      let tz;
      if (rng() < 0.26) {
        tx = (rng() - 0.5) * CUBE_W * 0.86;
        ty = (rng() - 0.5) * CUBE_H * 0.86;
        tz = (rng() - 0.5) * CUBE_D * 0.82;
      } else {
        tx = hx + (rng() - 0.5) * 1.7;
        ty = hy + (rng() - 0.5) * 1.75;
        tz = (rng() - 0.5) * 1.85;
        tx = Math.max(-CUBE_W / 2 + 0.14, Math.min(CUBE_W / 2 - 0.14, tx));
        ty = Math.max(-CUBE_H / 2 + 0.14, Math.min(CUBE_H / 2 - 0.14, ty));
      }
      targets.push(tx, ty, tz);

      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      // Natural hue, gently lifted so the dust is legible on a dark stage.
      colors.push(Math.min(1, r * 1.07 + 0.01), Math.min(1, g * 1.07 + 0.01), Math.min(1, b * 1.07 + 0.01));
      const roseBoost = r > g * 1.35 && r > b * 1.25 ? 0.9 : 0;
      sizes.push(1.8 + Math.pow(rng(), 1.7) * 4.1 + a * 0.8 + roseBoost);
      delays.push(rng() * 0.28);
      seeds.push(rng());
      alphas.push(0.45 + a * 0.38);
    }
  }

  state.particleCount = homes.length / 3;
  if (elements.particleCount) {
    elements.particleCount.textContent = state.particleCount.toLocaleString("en-US");
  } else {
    const note = document.querySelector(".intro__note");
    if (note) note.innerHTML = `一个由 ${state.particleCount.toLocaleString("en-US")} 颗粒子构成的全息人像。没有播放键，只有你手指之间的开合。`;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(homes, 3));
  geom.setAttribute("aTarget", new THREE.Float32BufferAttribute(targets, 3));
  geom.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geom.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  geom.setAttribute("aDelay", new THREE.Float32BufferAttribute(delays, 1));
  geom.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geom.setAttribute("aAlpha", new THREE.Float32BufferAttribute(alphas, 1));

  particleUniforms = {
    uDisperse: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uOpacity: { value: 0.92 }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: particleUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    vertexShader: `
      uniform float uDisperse;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOpacity;
      attribute vec3 aTarget;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aDelay;
      attribute float aSeed;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float local = smoothstep(aDelay, aDelay + 0.31, uDisperse);
        vec3 p = mix(position, aTarget, local);
        float t = uTime * 0.24 + aSeed * 6.2831853;
        p.x += sin(t + aSeed * 4.5) * (0.008 + 0.030 * local);
        p.y += cos(t * 0.83 + aSeed * 3.1) * (0.008 + 0.030 * local);
        p.z += sin(t * 0.61 + aSeed * 2.2) * (0.008 + 0.030 * local);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (8.6 / max(2.0, -mv.z));

        vColor = aColor;
        float appear = smoothstep(0.0, 0.10, local);
        vAlpha = appear * (0.35 + 0.65 * local) * aAlpha * uOpacity;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.02, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `
  });

  points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  root.add(points);

  // A sparse layer of large, low-opacity points gives the burst a smoky volume.
  const hHomes = [];
  const hTargets = [];
  const hColors = [];
  const hSizes = [];
  const hDelays = [];
  const hSeeds = [];
  const hAlphas = [];
  const total = homes.length / 3;
  for (let i = 0; i < total; i += 7) {
    const o = i * 3;
    hHomes.push(homes[o], homes[o + 1], homes[o + 2]);
    hTargets.push(targets[o], targets[o + 1], targets[o + 2]);
    hColors.push(colors[o], colors[o + 1], colors[o + 2]);
    hSizes.push(sizes[i]);
    hDelays.push(delays[i]);
    hSeeds.push(seeds[i]);
    hAlphas.push(alphas[i]);
  }

  const hazeGeom = new THREE.BufferGeometry();
  hazeGeom.setAttribute("position", new THREE.Float32BufferAttribute(hHomes, 3));
  hazeGeom.setAttribute("aTarget", new THREE.Float32BufferAttribute(hTargets, 3));
  hazeGeom.setAttribute("aColor", new THREE.Float32BufferAttribute(hColors, 3));
  hazeGeom.setAttribute("aSize", new THREE.Float32BufferAttribute(hSizes, 1));
  hazeGeom.setAttribute("aDelay", new THREE.Float32BufferAttribute(hDelays, 1));
  hazeGeom.setAttribute("aSeed", new THREE.Float32BufferAttribute(hSeeds, 1));
  hazeGeom.setAttribute("aAlpha", new THREE.Float32BufferAttribute(hAlphas, 1));

  const hazeMaterial = new THREE.ShaderMaterial({
    uniforms: particleUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uDisperse;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOpacity;
      attribute vec3 aTarget;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aDelay;
      attribute float aSeed;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float local = smoothstep(aDelay, aDelay + 0.31, uDisperse);
        vec3 p = mix(position, aTarget, local);
        float t = uTime * 0.18 + aSeed * 6.2831853;
        p.x += sin(t + aSeed * 4.0) * (0.01 + 0.06 * local);
        p.y += cos(t * 0.73 + aSeed * 3.0) * (0.01 + 0.06 * local);
        p.z += sin(t * 0.51 + aSeed * 2.0) * (0.01 + 0.06 * local);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (8.6 / max(2.0, -mv.z)) * 4.4;
        vColor = aColor;
        vAlpha = smoothstep(0.0, 0.14, local) * (0.035 + 0.105 * local) * aAlpha * uOpacity;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.005, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `
  });

  const haze = new THREE.Points(hazeGeom, hazeMaterial);
  haze.frustumCulled = false;
  haze.renderOrder = 3;
  root.add(haze);
}

function onResize() {
  if (!renderer || !camera) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.z = window.innerWidth < 1180 ? 14.35 : 13.4;
  camera.updateProjectionMatrix();
  if (particleUniforms) particleUniforms.uPixelRatio.value = renderer.getPixelRatio();
}

/* -----------------------------------------------------------------------
   Animation
------------------------------------------------------------------------ */

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function autoDispersion(time) {
  const cycle = 14;
  const p = (time % cycle) / cycle;
  if (p < 0.16) return 0;
  if (p < 0.43) return smoothstep(0, 1, (p - 0.16) / 0.27);
  if (p < 0.58) return 1;
  if (p < 0.85) return 1 - smoothstep(0, 1, (p - 0.58) / 0.27);
  return 0;
}

function updateHUD(force = false) {
  const now = performance.now();
  if (!force && now - state.lastHudUpdate < 55) return;
  state.lastHudUpdate = now;

  const percent = Math.round(state.dispersion * 100);
  if (force || percent !== state.lastHudPercent) {
    state.lastHudPercent = percent;
    const padded = String(percent).padStart(3, "0");
    elements.dispersionValue.textContent = padded;
    elements.meterFill.style.transform = `scaleX(${state.dispersion.toFixed(4)})`;
    elements.meterMarker.style.left = `${state.dispersion * 100}%`;
  }

  let label = "INTACT";
  if (state.dispersion > 0.92) label = "SCATTERED";
  else if (state.dispersion > 0.08) {
    if (state.targetDispersion > state.dispersion + 0.006) label = "DISPERSING";
    else if (state.targetDispersion < state.dispersion - 0.006) label = "REFORMING";
    else label = "IN FLUX";
  }
  if (elements.stateText.textContent !== label) elements.stateText.textContent = label;
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!renderer || !scene || !camera) return;

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (state.mode === "auto") {
    state.targetDispersion = autoDispersion(elapsed - state.autoClock);
  }

  const k = 1 - Math.exp(-delta * (state.mode === "auto" ? 4.2 : 6.5));
  state.dispersion += (state.targetDispersion - state.dispersion) * k;
  if (Math.abs(state.targetDispersion - state.dispersion) < 0.0004) {
    state.dispersion = state.targetDispersion;
  }

  if (planeUniforms) {
    planeUniforms.uDisperse.value = state.dispersion;
    planeUniforms.uTime.value = elapsed;
    planeUniforms.uScan.value = 0.5 - 0.5 * Math.cos(elapsed * 0.28);
  }
  if (particleUniforms) {
    particleUniforms.uDisperse.value = state.dispersion;
    particleUniforms.uTime.value = elapsed;
  }

  if (root) {
    root.rotation.y = 0.19 * Math.sin(elapsed * (Math.PI * 2 / 16));
    root.rotation.x = 0.028 * Math.sin(elapsed * (Math.PI * 2 / 11) + 0.8);
    root.position.y = 0.18 + 0.035 * Math.sin(elapsed * (Math.PI * 2 / 7) + 0.3);
  }
  if (dust) dust.rotation.y = elapsed * 0.012;
  if (sweepLine) sweepLine.rotation.y = -elapsed * 0.32;

  updateHUD();
  renderer.render(scene, camera);
}

/* -----------------------------------------------------------------------
   Modes, UI and pointer control
------------------------------------------------------------------------ */

function setStatus(text, tone = "idle") {
  elements.statusText.textContent = text;
  elements.statusChip.dataset.tone = tone;
}

function showToast(message, duration = 3200) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
}

function setGateMessage(text, tone = "error") {
  elements.gateMessage.textContent = text;
  elements.gateMessage.dataset.tone = tone;
}

function enterExperience(mode) {
  state.entered = true;
  state.mode = mode;
  state.autoClock = clock ? clock.elapsedTime : 0;
  document.body.classList.add("is-entered");
  elements.gate.classList.add("is-hidden");
  elements.cameraCard.style.display = mode === "camera" ? "" : "none";
  elements.stageHint.textContent =
    mode === "auto" ? "AUTO CYCLE / 14S" : mode === "pointer" ? "MOVE POINTER ↔" : "SHOW YOUR HAND";
  elements.footerMode.textContent =
    mode === "auto" ? "AUTO DEMO / 14S LOOP" : mode === "pointer" ? "POINTER / HORIZONTAL" : "CAMERA / HAND TRACKING";
  if (mode === "auto") setStatus("自动演示中", "demo");
  if (mode === "pointer") setStatus("鼠标控制中", "demo");
  if (mode === "camera") setStatus("等待手掌", "idle");
  elements.demoModeBtn.textContent = mode === "auto" ? "用鼠标体验 ↗" : "自动演示 ↗";
  updateHUD(true);
}

function enterAuto(options = {}) {
  stopCamera();
  stopDetection();
  enterExperience("auto");
  state.autoClock = clock ? clock.elapsedTime : 0;
  if (!options.skipGate) showToast("自动演示：散开与复原循环。");
}

function enterPointer(options = {}) {
  stopCamera();
  stopDetection();
  bindPointer();
  enterExperience("pointer");
  document.body.classList.add("pointer-mode");
  if (!options.skipGate) showToast("鼠标模式：左右移动控制散开程度。");
}

function bindPointer() {
  if (state.pointerBound) return;
  state.pointerBound = true;
  window.addEventListener("pointermove", (event) => {
    if (state.mode !== "pointer") return;
    state.targetDispersion = THREE.MathUtils.clamp(event.clientX / window.innerWidth, 0, 1);
  }, { passive: true });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => showToast("当前浏览器不允许全屏。"));
  } else {
    document.exitFullscreen?.();
  }
}

/* -----------------------------------------------------------------------
   Camera + MediaPipe
------------------------------------------------------------------------ */

let cameraStream = null;
let handLandmarker = null;
let detectionFrame = 0;
let lastDetectionAt = -Infinity;
let lastHandSeen = 0;
let lastRaw = null;
let visionModulePromise = null;
let detectionCanvas = null;
let detectionCtx = null;
let oneEuro = null;

class OneEuroFilter {
  constructor(minCutoff = 1.2, beta = 0.06, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, timestamp) {
    if (this.tPrev === null) {
      this.tPrev = timestamp;
      this.xPrev = value;
      return value;
    }
    let dt = timestamp - this.tPrev;
    if (dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    const dx = (value - this.xPrev) / dt;
    this.dxPrev += (dx - this.dxPrev) * this.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    this.xPrev += (value - this.xPrev) * this.alpha(cutoff, dt);
    this.tPrev = timestamp;
    return this.xPrev;
  }
}

function makeDetectionCanvas() {
  detectionCanvas = document.createElement("canvas");
  detectionCanvas.width = 640;
  detectionCanvas.height = 480;
  detectionCtx = detectionCanvas.getContext("2d", { willReadFrequently: false });
}

async function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 }
    }
  });
  cameraStream = stream;
  const video = elements.webcam;
  video.srcObject = stream;
  video.style.opacity = "0.74";

  const metadata = new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("error", fail);
    };
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const fail = () => {
      cleanup();
      const error = new Error("Camera stream failed");
      error.name = "CameraStartError";
      reject(error);
    };
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("error", fail);
    timer = setTimeout(() => {
      cleanup();
      const error = new Error("Camera produced no frames");
      error.name = "CameraStartError";
      reject(error);
    }, 8000);
  });

  video.play().catch((error) => console.warn("First camera play blocked", error));
  try {
    await metadata;
    if (video.paused) await video.play();
    if (!video.videoWidth) throw new Error("Camera has no dimensions");
  } catch (error) {
    stopCamera();
    throw error;
  }
  state.cameraReady = true;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.webcam.srcObject = null;
  state.cameraReady = false;
}

async function initHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  if (!visionModulePromise) {
    visionModulePromise = import("../assets/mediapipe/vendor/vision_bundle.mjs");
  }
  const { FilesetResolver, HandLandmarker } = await visionModulePromise;
  const vision = await FilesetResolver.forVisionTasks(
    new URL("../assets/mediapipe/wasm", location.href).href
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: new URL("../assets/mediapipe/hand_landmarker.task", location.href).href,
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.35
  });
  return handLandmarker;
}

async function beginCamera() {
  if (state.starting || state.entered) return;
  state.starting = true;
  elements.startBtn.classList.add("is-loading");
  elements.autoBtn.disabled = true;
  elements.pointerBtn.disabled = true;
  setGateMessage("正在请求摄像头并载入手势模型…", "muted");
  setStatus("连接中", "idle");

  try {
    await sceneReady;
    makeDetectionCanvas();
    await Promise.all([initCamera(), initHandLandmarker()]);
    state.starting = false;
    setGateMessage("");
    state.lastHandSeen = performance.now();
    oneEuro = new OneEuroFilter();
    enterExperience("camera");
    elements.cameraCard.dataset.state = "live";
    elements.cameraIdleText.textContent = "CAMERA READY";
    elements.cameraBadge.textContent = "SEARCHING";
    elements.cameraMode.textContent = "LOCAL / NO UPLOAD";
    startDetection();
    showToast("摄像头已连接。张开手指让他散开，合拢手指让他回来。", 4200);
  } catch (error) {
    console.error(error);
    state.starting = false;
    elements.startBtn.classList.remove("is-loading");
    elements.autoBtn.disabled = false;
    elements.pointerBtn.disabled = false;
    stopCamera();
    stopDetection();
    setStatus("摄像头不可用", "error");
    setGateMessage(friendlyCameraError(error), "error");
  }
}

function friendlyCameraError(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "当前页面无法使用摄像头。请通过 localhost 或 HTTPS 打开。";
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "摄像头权限被拒绝。你可以使用自动演示，先看完整效果。";
  }
  if (error?.name === "CameraStartError" || /frames|dimensions/i.test(String(error?.message))) {
    return "摄像头没有输出画面。请关闭其他占用摄像头的应用，或改用 Safari / 开启图形加速后重试。";
  }
  if (error?.name === "NotFoundError") {
    return "没有找到摄像头。你可以先用自动演示查看效果。";
  }
  return "连接摄像头时出了点问题。你可以使用自动演示或鼠标体验。";
}

function startDetection() {
  if (detectionFrame || !handLandmarker) return;
  lastDetectionAt = -Infinity;
  detectionFrame = requestAnimationFrame(detectLoop);
}

function stopDetection() {
  if (detectionFrame) cancelAnimationFrame(detectionFrame);
  detectionFrame = 0;
}

function detectLoop(now) {
  detectionFrame = requestAnimationFrame(detectLoop);
  if (state.mode !== "camera" || document.hidden || !handLandmarker || !cameraStream) return;
  const video = elements.webcam;
  if (video.readyState < 2 || !video.videoWidth) return;
  if (now - lastDetectionAt < 40) return;
  lastDetectionAt = now;

  try {
    const s = 640 / 480;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(640 / vw, 480 / vh);
    const sw = 640 / scale;
    const sh = 480 / scale;
    detectionCtx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, 640, 480);
    const result = handLandmarker.detectForVideo(detectionCanvas, now);
    processHand(result, now);
  } catch (error) {
    console.error("Detection error", error);
    setStatus("识别异常", "error");
    elements.cameraBadge.textContent = "TRACKER ERROR";
  }
}

function processHand(result, now) {
  const normalized = result?.landmarks?.[0];
  const world = result?.worldLandmarks?.[0];
  if (!normalized) {
    if (state.handPresent && now - state.lastHandSeen > 220) {
      state.handPresent = false;
      handCtxClear();
      setStatus("等待手掌", "idle");
      elements.stageHint.textContent = "SHOW YOUR HAND";
      elements.cameraBadge.textContent = "SEARCHING";
      elements.footerMode.textContent = "CAMERA / SEARCHING FOR HAND";
    }
    return;
  }

  state.handPresent = true;
  state.lastHandSeen = now;
  setStatus("手势追踪中", "active");
  elements.stageHint.textContent = "HAND LOCKED";
  elements.cameraBadge.textContent = "HAND LOCKED";
  elements.footerMode.textContent = "CAMERA / HAND TRACKING";
  drawHand(normalized);

  if (!oneEuro) oneEuro = new OneEuroFilter();
  const raw = measureOpenness(world || normalized);
  if (Number.isFinite(raw)) {
    lastRaw = raw;
    state.targetDispersion = THREE.MathUtils.clamp(oneEuro.filter(raw, now / 1000), 0, 1);
  }

  if (!state.handSeenOnce) {
    state.handSeenOnce = true;
    showToast("已锁定手掌。张开手指散开，合拢手指复原。", 3800);
  }
}

function measureOpenness(world) {
  const wrist = world[0];
  const palmLength = dist3(wrist, world[9]) || 1e-6;
  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, weight: 1.0 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, weight: 1.06 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, weight: 0.95 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, weight: 0.9 }
  ];
  let extension = 0;
  let weightSum = 0;
  for (const finger of fingers) {
    const mcp = world[finger.mcp];
    const pip = world[finger.pip];
    const dip = world[finger.dip];
    const tip = world[finger.tip];
    const bone = dist3(mcp, pip) + dist3(pip, dip) + dist3(dip, tip);
    const chord = dist3(mcp, tip);
    const straight = clamp(chord / (bone || 1e-6));
    const base = normalize3({ x: mcp.x - wrist.x, y: mcp.y - wrist.y, z: mcp.z - wrist.z });
    const out = normalize3({ x: tip.x - mcp.x, y: tip.y - mcp.y, z: tip.z - mcp.z });
    const forward = dot3(out, base);
    const open = clamp(smoothstep(0.56, 0.93, straight) * 0.7 + smoothstep(-0.18, 0.82, forward) * 0.3);
    extension += open * finger.weight;
    weightSum += finger.weight;
  }
  extension /= weightSum || 1;
  const palmWidth = dist3(world[5], world[17]) || palmLength;
  const pinchRatio = dist3(world[4], world[8]) / (palmWidth || 1e-6);
  const pinchGate = smoothstep(0.26, 0.92, pinchRatio);
  const raw = extension * (0.12 + 0.88 * pinchGate);
  return clamp((raw - 0.15) / 0.83);
}

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function normalize3(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];

const handCtx = elements.handCanvas.getContext("2d");
elements.handCanvas.width = 640;
elements.handCanvas.height = 480;

function handCtxClear() {
  handCtx.clearRect(0, 0, elements.handCanvas.width, elements.handCanvas.height);
}

function drawHand(landmarks) {
  const canvas = elements.handCanvas;
  const w = canvas.width;
  const h = canvas.height;
  handCtx.clearRect(0, 0, w, h);
  const points = landmarks.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));
  handCtx.lineCap = "round";
  handCtx.lineJoin = "round";
  handCtx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    handCtx.moveTo(points[a].x, points[a].y);
    handCtx.lineTo(points[b].x, points[b].y);
  }
  handCtx.strokeStyle = "rgba(188, 230, 241, .68)";
  handCtx.lineWidth = 2.2;
  handCtx.stroke();
  handCtx.beginPath();
  for (const [index, p] of points.entries()) {
    if ([0,4,8,12,16,20].includes(index)) {
      handCtx.moveTo(p.x + 4, p.y);
      handCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    }
  }
  handCtx.fillStyle = "rgba(245, 253, 255, .95)";
  handCtx.fill();
}

/* -----------------------------------------------------------------------
   Init / controls
------------------------------------------------------------------------ */

function bindControls() {
  elements.startBtn.addEventListener("click", beginCamera);
  elements.autoBtn.addEventListener("click", () => enterAuto());
  elements.pointerBtn.addEventListener("click", () => enterPointer());
  elements.demoModeBtn.addEventListener("click", () => {
    if (state.mode === "auto") enterPointer();
    else enterAuto();
  });
  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const on = Boolean(document.fullscreenElement);
    elements.fullscreenBtn.setAttribute("aria-label", on ? "退出全屏" : "进入全屏");
  });
}

function boot() {
  if (params.has("clean")) document.body.classList.add("cinema");
  bindControls();
  initThree();
  if (!state.webgl) {
    setGateMessage("此浏览器无法创建 WebGL 场景。请开启硬件加速并重启浏览器，或改用 Safari。", "error");
    elements.startBtn.disabled = true;
    elements.autoBtn.disabled = true;
    elements.pointerBtn.disabled = true;
    setStatus("WebGL 不可用", "error");
  }
  if (elements.particleCount) elements.particleCount.textContent = "13,000";
  updateHUD(true);
  requestAnimationFrame(renderLoop);
}


window.__holo = {
  setDispersion(value, immediate = false) {
    const v = clamp(Number(value));
    state.targetDispersion = v;
    if (immediate) state.dispersion = v;
  },
  getState() {
    return {
      mode: state.mode,
      dispersion: state.dispersion,
      target: state.targetDispersion,
      handPresent: state.handPresent,
      particleCount: state.particleCount,
      ready: state.ready
    };
  },
  enterAuto,
  enterPointer
};

boot();
