import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const params = new URLSearchParams(window.location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

if (params.has("clean")) document.body.classList.add("clean");

const stage = $("stageWrap");
const canvas = $("stage");
const loader = $("loader");
const errorPanel = $("error");
const gate = $("gestureGate");
const startBtn = $("startBtn");
const autoBtn = $("autoBtn");
const pointerBtn = $("pointerBtn");
const gateMessage = $("gateMessage");
const hud = $("gestureHud");
const modeLabel = $("modeLabel");
const statusText = $("statusText");
const dispersionValue = $("dispersionValue");
const meterFill = $("meterFill");
const gestureState = $("gestureState");
const gestureHint = $("gestureHint");
const handCamera = $("handCamera");
const webcam = $("webcam");
const handCanvas = $("handCanvas");
const spinBtn = $("spinBtn");
const spinLabel = $("spinLabel");

const state = {
  mode: "gate",
  entered: false,
  starting: false,
  cameraReady: false,
  handPresent: false,
  handSeenOnce: false,
  lastHandSeen: 0,
  noHandSince: 0,
  targetDispersion: 0,
  dispersion: 0,
  autoClock: 0,
  lastHud: -1,
  lastStatus: "",
  pointerBound: false,
};
const fixedDispersion = params.has("d") ? clamp(parseFloat(params.get("d")) || 0) : null;
if (fixedDispersion !== null) {
  state.targetDispersion = fixedDispersion;
  state.dispersion = fixedDispersion;
}

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
camera.position.set(0.255, 0.505, 0.98);
camera.lookAt(0.0, 0.225, 0.015);

const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment(renderer);
const envTexture = pmrem.fromScene(room, 0.04).texture;
scene.environment = envTexture;
pmrem.dispose();
room.dispose?.();

scene.add(new THREE.HemisphereLight(0xfff5e6, 0x180b06, 0.22));
const keyLight = new THREE.DirectionalLight(0xfffaf5, 1.15);
keyLight.position.set(-1.15, 2.35, 1.6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d2ff, 0.40);
fillLight.position.set(1.5, 0.9, -0.8);
scene.add(fillLight);
const roseRim = new THREE.PointLight(0xff8391, 0.85, 2.6, 2.0);
roseRim.position.set(0.72, 1.08, -0.65);
scene.add(roseRim);
const frontFill = new THREE.PointLight(0xffb0b6, 0.28, 2.2, 2.0);
frontFill.position.set(-0.35, 0.60, 1.05);
scene.add(frontFill);

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
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: radialTexture("rgba(109, 22, 32, 0.21)", "rgba(55, 16, 23, 0.07)", "rgba(0,0,0,0)"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    opacity: 0.9,
  })
);
halo.position.set(0, 0.22, -1.05);
halo.scale.set(1.55, 1.12, 1);
halo.renderOrder = -5;
scene.add(halo);

const bouquet = new THREE.Group();
bouquet.name = "rose-bouquet";
scene.add(bouquet);

let autoSpin = params.get("still") !== "1";
let rotation = THREE.MathUtils.degToRad(parseFloat(params.get("a") || "-7"));
if (!Number.isFinite(rotation)) rotation = 0;
bouquet.rotation.y = rotation;

let composer = null;
let bloom = null;
let clock = null;
let goldMaterial = null;
let dissolveMaterial = null;
let dissolveHazeMaterial = null;
let solidMaterials = [];
let firstFrame = true;
let initialModeStarted = false;

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
function setGateMessage(text, tone = "error") {
  if (!gateMessage) return;
  gateMessage.textContent = text;
  gateMessage.dataset.tone = tone;
}
function showGate() {
  if (!gate || params.has("clean") || params.has("demo") || params.has("pointer") || fixedDispersion !== null) return;
  gate.hidden = false;
}
function hideGate() {
  if (!gate) return;
  gate.classList.add("is-hidden");
  window.setTimeout(() => { gate.hidden = true; }, 750);
}
function enterLive(mode, label, hint) {
  state.mode = mode;
  state.entered = true;
  document.body.classList.add("is-live");
  hideGate();
  if (hud) hud.hidden = false;
  if (modeLabel) modeLabel.textContent = label;
  if (gestureHint) gestureHint.textContent = hint;
  if (statusText) statusText.textContent = mode === "camera" ? "等待手掌" : "实时";
  if (handCamera) handCamera.hidden = mode !== "camera";
  if (mode === "camera") state.noHandSince = performance.now();
}

function enterAuto(skipGate = false) {
  if (state.mode === "camera" && !skipGate) return;
  state.autoClock = clock ? clock.elapsedTime : 0;
  state.targetDispersion = 0;
  enterLive("auto", "AUTO", "自动演示：花瓣散开，再重新聚拢。");
  if (autoBtn) autoBtn.disabled = true;
  if (pointerBtn) pointerBtn.disabled = false;
}
function startPointer() {
  state.autoClock = 0;
  state.targetDispersion = 0;
  enterLive("pointer", "POINTER", "左右移动鼠标，控制花瓣的消散程度。");
  if (!state.pointerBound) {
    state.pointerBound = true;
    window.addEventListener("pointermove", (event) => {
      if (state.mode !== "pointer") return;
      state.targetDispersion = clamp((event.clientX / window.innerWidth - 0.06) / 0.88);
    });
  }
}

startBtn?.addEventListener("click", beginCamera);
autoBtn?.addEventListener("click", () => enterAuto());
pointerBtn?.addEventListener("click", startPointer);

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key.toLowerCase() === "r") {
    autoSpin = !autoSpin;
    spinBtn?.setAttribute("aria-pressed", String(autoSpin));
    if (spinLabel) spinLabel.textContent = autoSpin ? "PAUSE MOTION" : "RESUME MOTION";
  }
});

/* -----------------------------------------------------------------------
   MediaPipe + camera
------------------------------------------------------------------------ */

let cameraStream = null;
let handLandmarker = null;
let detectionFrame = 0;
let lastDetectionAt = -Infinity;
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

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];
const handCtx = handCanvas.getContext("2d");
handCanvas.width = 320;
handCanvas.height = 240;

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
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
  });
  cameraStream = stream;
  webcam.srcObject = stream;
  const metadata = new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      webcam.removeEventListener("loadedmetadata", check);
      webcam.removeEventListener("loadeddata", check);
      webcam.removeEventListener("canplay", check);
      webcam.removeEventListener("error", fail);
    };
    const check = () => {
      if (webcam.videoWidth > 0 && webcam.videoHeight > 0) {
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
    webcam.addEventListener("loadedmetadata", check);
    webcam.addEventListener("loadeddata", check);
    webcam.addEventListener("canplay", check);
    webcam.addEventListener("error", fail);
    timer = setTimeout(() => {
      cleanup();
      const error = new Error("Camera produced no frames");
      error.name = "CameraStartError";
      reject(error);
    }, 8000);
  });
  webcam.play().catch((error) => console.warn("Camera play blocked", error));
  await metadata;
  if (webcam.paused) await webcam.play();
  if (!webcam.videoWidth) throw new Error("Camera has no dimensions");
  state.cameraReady = true;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  webcam.srcObject = null;
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
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.35,
  });
  return handLandmarker;
}

async function beginCamera() {
  if (state.starting || state.entered) return;
  state.starting = true;
  startBtn.classList.add("is-loading");
  startBtn.textContent = "连接中…";
  autoBtn.disabled = true;
  pointerBtn.disabled = true;
  setGateMessage("正在请求摄像头并载入手势模型…", "muted");
  // Keep the video element rendered (behind the gate) while the stream warms
  // up; some browsers stop delivering frames to a display:none video.
  if (hud) hud.hidden = false;
  if (handCamera) handCamera.hidden = false;
  try {
    makeDetectionCanvas();
    await Promise.all([initCamera(), initHandLandmarker()]);
    state.starting = false;
    startBtn.classList.remove("is-loading");
    startBtn.textContent = "开启摄像头";
    setGateMessage("");
    state.lastHandSeen = performance.now();
    state.noHandSince = performance.now();
    oneEuro = new OneEuroFilter(1.4, 0.05, 1.0);
    enterLive("camera", "CAMERA", "张开手掌，让花瓣散开；握拳，让它们重新聚拢。");
    if (statusText) statusText.textContent = "寻找手掌";
    startDetection();
  } catch (error) {
    console.error(error);
    state.starting = false;
    startBtn.classList.remove("is-loading");
    startBtn.textContent = "开启摄像头";
    autoBtn.disabled = false;
    pointerBtn.disabled = false;
    stopCamera();
    stopDetection();
    setGateMessage(friendlyCameraError(error), "error");
    if (hud) hud.hidden = true;
    if (handCamera) handCamera.hidden = true;
    gate.hidden = false;
  }
}

function friendlyCameraError(error) {
  if (!navigator.mediaDevices?.getUserMedia) return "当前页面无法使用摄像头，请通过 localhost 打开，或使用自动演示。";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "摄像头权限被拒绝。你可以使用自动演示或鼠标体验。";
  if (error?.name === "CameraStartError" || /frames|dimensions/i.test(String(error?.message))) return "摄像头没有输出画面。请关闭其他占用摄像头的应用，或改用 Safari。";
  if (error?.name === "NotFoundError") return "没有找到摄像头。你可以使用自动演示。";
  return "摄像头连接失败。你可以使用自动演示或鼠标体验。";
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
  if (webcam.readyState < 2 || !webcam.videoWidth) return;
  if (now - lastDetectionAt < 40) return;
  lastDetectionAt = now;
  try {
    const vw = webcam.videoWidth;
    const vh = webcam.videoHeight;
    const scale = Math.max(640 / vw, 480 / vh);
    const sw = 640 / scale;
    const sh = 480 / scale;
    detectionCtx.drawImage(webcam, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, 640, 480);
    const result = handLandmarker.detectForVideo(detectionCanvas, now);
    processHand(result, now);
  } catch (error) {
    console.error("Detection error", error);
    if (statusText) statusText.textContent = "识别异常";
  }
}
function clearHandCanvas() {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
}
function drawHand(landmarks) {
  clearHandCanvas();
  const w = handCanvas.width;
  const h = handCanvas.height;
  const points = landmarks.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));
  handCtx.lineCap = "round";
  handCtx.lineJoin = "round";
  handCtx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    handCtx.moveTo(points[a].x, points[a].y);
    handCtx.lineTo(points[b].x, points[b].y);
  }
  handCtx.strokeStyle = "rgba(233, 171, 184, .68)";
  handCtx.lineWidth = 1.8;
  handCtx.stroke();
  handCtx.beginPath();
  for (const [index, p] of points.entries()) {
    if ([0,4,8,12,16,20].includes(index)) {
      handCtx.moveTo(p.x + 3, p.y);
      handCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    }
  }
  handCtx.fillStyle = "rgba(255, 235, 239, .95)";
  handCtx.fill();
}
function processHand(result, now) {
  const normalized = result?.landmarks?.[0];
  const world = result?.worldLandmarks?.[0];
  if (!normalized) {
    if (state.handPresent && now - state.lastHandSeen > 220) {
      state.handPresent = false;
      state.noHandSince = now;
      clearHandCanvas();
      if (statusText) statusText.textContent = "等待手掌";
      if (gestureHint) gestureHint.textContent = "把手掌放入画面，张开或握拳。";
    }
    return;
  }
  state.handPresent = true;
  state.lastHandSeen = now;
  state.noHandSince = 0;
  if (statusText) statusText.textContent = "手势追踪中";
  if (gestureHint) gestureHint.textContent = "张开手掌散开 · 握拳聚拢";
  drawHand(normalized);
  if (!oneEuro) oneEuro = new OneEuroFilter(1.4, 0.05, 1.0);
  const raw = measureOpenness(world || normalized);
  if (Number.isFinite(raw)) {
    // small deadband keeps the flower fully intact / fully gone at the ends
    let v = clamp((raw - 0.04) / 0.90);
    if (v < 0.035) v = 0;
    if (v > 0.965) v = 1;
    state.targetDispersion = oneEuro.filter(v, now / 1000);
  }
}
function measureOpenness(world) {
  const wrist = world[0];
  const palmLength = dist3(wrist, world[9]) || 1e-6;
  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, weight: 1.0 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, weight: 1.06 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, weight: 0.95 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, weight: 0.9 },
  ];
  let extension = 0;
  let weightSum = 0;
  for (const f of fingers) {
    const mcp = world[f.mcp], pip = world[f.pip], dip = world[f.dip], tip = world[f.tip];
    const bone = dist3(mcp, pip) + dist3(pip, dip) + dist3(dip, tip);
    const chord = dist3(mcp, tip);
    const straight = clamp(chord / (bone || 1e-6));
    const base = normalize3({ x: mcp.x - wrist.x, y: mcp.y - wrist.y, z: mcp.z - wrist.z });
    const out = normalize3({ x: tip.x - mcp.x, y: tip.y - mcp.y, z: tip.z - mcp.z });
    const forward = dot3(out, base);
    const open = clamp(smoothstep(0.56, 0.93, straight) * 0.7 + smoothstep(-0.18, 0.82, forward) * 0.3);
    extension += open * f.weight;
    weightSum += f.weight;
  }
  extension /= weightSum || 1;
  const palmWidth = dist3(world[5], world[17]) || palmLength;
  const pinchRatio = dist3(world[4], world[8]) / (palmWidth || 1e-6);
  const pinchGate = smoothstep(0.26, 0.92, pinchRatio);
  const raw = extension * (0.12 + 0.88 * pinchGate);
  return clamp((raw - 0.15) / 0.83);
}
function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function normalize3(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

/* -----------------------------------------------------------------------
   Particle data
------------------------------------------------------------------------ */

async function loadParticles() {
  const response = await fetch("./assets/rose_particles.bin");
  if (!response.ok) throw new Error("Particle data missing");
  const buffer = await response.arrayBuffer();
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "RGP1") throw new Error("Bad particle data");
  const count = new DataView(buffer).getUint32(4, true);
  let offset = 8;
  const take3 = () => {
    const arr = new Float32Array(buffer, offset, count * 3);
    offset += count * 12;
    return arr;
  };
  const take1 = () => {
    const arr = new Float32Array(buffer, offset, count);
    offset += count * 4;
    return arr;
  };
  const positions = take3();
  const targets = take3();
  const colors = take3();
  const sizes = take1();
  const delays = take1();
  const seeds = take1();
  const alphas = take1();
  return { count, positions, targets, colors, sizes, delays, seeds, alphas };
}

function buildDissolveParticles(data) {
  const { count, positions, targets, colors, sizes, delays, seeds, alphas } = data;
  const uniforms = {
    uDispersion: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
  geom.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute("aDelay", new THREE.BufferAttribute(delays, 1));
  geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geom.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

  dissolveMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    vertexShader: `
      uniform float uDispersion;
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 aTarget;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aDelay;
      attribute float aSeed;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float local = smoothstep(aDelay, aDelay + 0.42, uDispersion);
        float eased = local * local * (3.0 - 2.0 * local);
        vec3 p = mix(position, aTarget, eased);
        float t = uTime * 0.55 + aSeed * 6.2831853;
        p.x += sin(t * 1.1 + aSeed * 3.0) * (0.0015 + 0.012 * local);
        p.y += cos(t * 0.83 + aSeed * 2.0) * (0.0015 + 0.012 * local);
        p.z += sin(t * 0.67 + aSeed * 4.0) * (0.0015 + 0.012 * local);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float appear = smoothstep(0.012, 0.16, uDispersion);
        float vanish = 1.0 - smoothstep(0.56, 1.0, uDispersion);
        float twinkle = 0.78 + 0.22 * sin(uTime * 1.4 + aSeed * 9.0);
        gl_PointSize = aSize * uPixelRatio * (0.78 / max(0.18, -mv.z)) * (0.72 + 0.52 * local);
        vColor = aColor;
        vAlpha = aAlpha * appear * vanish * twinkle * (0.58 + 0.42 * local);
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
        float core = 1.0 - smoothstep(0.0, 0.06, d2);
        float halo = 1.0 - smoothstep(0.005, 0.25, d2);
        vec3 col = mix(vColor, vec3(1.0, 0.74, 0.78), core * 0.22);
        gl_FragColor = vec4(col, (core * 0.74 + halo * 0.34) * vAlpha);
      }
    `,
  });
  const points = new THREE.Points(geom, dissolveMaterial);
  points.frustumCulled = false;
  points.renderOrder = 3;
  bouquet.add(points);

  // A sparse additive haze gives the dissolve its soft holographic glow.
  const hCount = Math.ceil(count / 6);
  const hp = new Float32Array(hCount * 3);
  const ht = new Float32Array(hCount * 3);
  const hc = new Float32Array(hCount * 3);
  const hs = new Float32Array(hCount);
  const hd = new Float32Array(hCount);
  const hseed = new Float32Array(hCount);
  const ha = new Float32Array(hCount);
  let j = 0;
  for (let i = 0; i < count && j < hCount; i += 6, j += 1) {
    hp[j*3] = positions[i*3]; hp[j*3+1] = positions[i*3+1]; hp[j*3+2] = positions[i*3+2];
    ht[j*3] = targets[i*3]; ht[j*3+1] = targets[i*3+1]; ht[j*3+2] = targets[i*3+2];
    hc[j*3] = colors[i*3]; hc[j*3+1] = colors[i*3+1]; hc[j*3+2] = colors[i*3+2];
    hs[j] = sizes[i] * 2.6;
    hd[j] = delays[i];
    hseed[j] = seeds[i];
    ha[j] = alphas[i] * 0.38;
  }
  const hGeom = new THREE.BufferGeometry();
  hGeom.setAttribute("position", new THREE.BufferAttribute(hp, 3));
  hGeom.setAttribute("aTarget", new THREE.BufferAttribute(ht, 3));
  hGeom.setAttribute("aColor", new THREE.BufferAttribute(hc, 3));
  hGeom.setAttribute("aSize", new THREE.BufferAttribute(hs, 1));
  hGeom.setAttribute("aDelay", new THREE.BufferAttribute(hd, 1));
  hGeom.setAttribute("aSeed", new THREE.BufferAttribute(hseed, 1));
  hGeom.setAttribute("aAlpha", new THREE.BufferAttribute(ha, 1));
  dissolveHazeMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: dissolveMaterial.vertexShader,
    fragmentShader: `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float halo = 1.0 - smoothstep(0.0, 0.25, d2);
        gl_FragColor = vec4(vColor, halo * vAlpha * 0.55);
      }
    `,
  });
  const haze = new THREE.Points(hGeom, dissolveHazeMaterial);
  haze.frustumCulled = false;
  haze.renderOrder = 2;
  bouquet.add(haze);
}

/* -----------------------------------------------------------------------
   Build the scene
------------------------------------------------------------------------ */

async function boot() {
  const textureLoader = new THREE.TextureLoader();
  let normalMap = null;
  try {
    normalMap = await textureLoader.loadAsync("./assets/rose_normal.png");
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  } catch (error) {
    console.warn("Petal normal map unavailable", error);
  }

  const petal = (color, roughness, coat) => new THREE.MeshPhysicalMaterial({
    color,
    normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness,
    metalness: 0.0,
    clearcoat: coat,
    clearcoatRoughness: 0.09,
    sheen: 0.86,
    sheenColor: new THREE.Color(0xffd1dc),
    sheenRoughness: 0.34,
    emissive: new THREE.Color(0x220308),
    emissiveIntensity: 0.22,
    envMapIntensity: 0.86,
  });
  const materials = {
    Pastel_Rose_Inner: petal(0x3f050c, 0.36, 0.82),
    Pastel_Rose_Mid: petal(0x590812, 0.33, 0.86),
    Pastel_Rose_Outer: petal(0x7c101c, 0.29, 0.90),
    Pastel_Calyx: new THREE.MeshPhysicalMaterial({
      color: 0x203119, roughness: 0.34, metalness: 0.03, clearcoat: 0.6,
      sheen: 0.6, sheenColor: new THREE.Color(0xc39a55), sheenRoughness: 0.4,
      envMapIntensity: 1.0,
    }),
    Pastel_Leaf: new THREE.MeshPhysicalMaterial({
      color: 0x3c6a31, roughness: 0.48, metalness: 0.0, clearcoat: 0.32,
      clearcoatRoughness: 0.16, sheen: 0.24, sheenColor: new THREE.Color(0xb1985c),
      sheenRoughness: 0.52, envMapIntensity: 0.82,
    }),
    Pastel_Stem: new THREE.MeshPhysicalMaterial({
      color: 0x285126, roughness: 0.50, metalness: 0.0, clearcoat: 0.28,
      clearcoatRoughness: 0.18, sheen: 0.18, sheenColor: new THREE.Color(0x9e8b57),
      sheenRoughness: 0.55, envMapIntensity: 0.72,
    }),
    Pastel_Vein: new THREE.MeshStandardMaterial({
      color: 0xc89a4f, metalness: 0.52, roughness: 0.34,
      emissive: new THREE.Color(0x1c0f03), emissiveIntensity: 0.24, envMapIntensity: 1.0,
    }),
  };

  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync("./assets/rose_cluster.glb");
  } catch (error) {
    showError(error);
    return;
  }
  const model = gltf.scene;
  model.name = "rose-cluster-source";
  const used = new Set();
  model.traverse((child) => {
    if (!child.isMesh) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    const next = list.map((m) => materials[m?.name] || m);
    child.material = Array.isArray(child.material) ? next : next[0];
    child.castShadow = false;
    child.receiveShadow = false;
    for (const m of next) if (m) used.add(m);
  });
  solidMaterials = [...used];
  for (const m of solidMaterials) {
    m.opacity = 1;
    m.transparent = false;
    m.depthWrite = true;
  }
  bouquet.add(model);

  // Gold shimmer belongs to the intact bouquet and fades with it.
  let gold = null;
  try {
    const response = await fetch("./assets/gold_particles.json");
    if (response.ok) gold = await response.json();
  } catch (error) {
    console.warn("Gold shimmer unavailable", error);
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
        uFade: { value: 1 },
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
          vAlpha = aAlpha * (0.42 + 0.58 * twinkle) * 0.35;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uFade;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float core = 1.0 - smoothstep(0.0, 0.045, d2);
          float halo = 1.0 - smoothstep(0.01, 0.25, d2);
          vec3 col = mix(vColor, vec3(1.0, 0.93, 0.75), core * 0.5);
          gl_FragColor = vec4(col, (core * 0.82 + halo * 0.42) * vAlpha * uFade);
        }
      `,
    });
    const points = new THREE.Points(geometry, goldMaterial);
    points.frustumCulled = false;
    points.renderOrder = 5;
    bouquet.add(points);
  }

  try {
    const data = await loadParticles();
    buildDissolveParticles(data);
  } catch (error) {
    console.warn("Dissolve particles unavailable", error);
  }

  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.18, 0.45, 0.91);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  clock = new THREE.Clock();
  function resize() {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    const ratio = renderer.getPixelRatio();
    if (dissolveMaterial) dissolveMaterial.uniforms.uPixelRatio.value = ratio;
    if (goldMaterial) goldMaterial.uniforms.uPixelRatio.value = ratio;
  }
  window.addEventListener("resize", resize);
  resize();

  function updateSolid(d) {
    const opacity = 1.0 - smoothstep(0.04, 0.58, d);
    for (const m of solidMaterials) {
      const transparent = opacity < 0.995;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
    if (goldMaterial) goldMaterial.uniforms.uFade.value = clamp(opacity * 1.35);
  }

  function updateHud() {
    const percent = Math.round(state.dispersion * 100);
    if (percent === state.lastHud) return;
    state.lastHud = percent;
    if (dispersionValue) dispersionValue.textContent = String(percent).padStart(3, "0");
    if (meterFill) meterFill.style.width = `${percent}%`;
    if (gestureState) {
      const d = state.dispersion;
      const t = state.targetDispersion;
      let label = "INTACT";
      if (d > 0.93) label = "DISSOLVED";
      else if (Math.abs(t - d) > 0.01) label = t > d ? "DISSOLVING" : "REFORMING";
      else if (d > 0.05) label = "IN FLUX";
      gestureState.textContent = label;
    }
  }

  function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    if (autoSpin) {
      rotation += delta * 0.09;
      bouquet.rotation.y = rotation;
    }
    bouquet.position.y = 0.006 * Math.sin(elapsed * 0.38);

    if (fixedDispersion !== null) {
      state.targetDispersion = fixedDispersion;
    } else if (state.mode === "auto") {
      const cycle = (elapsed - state.autoClock) % 15.0;
      if (cycle < 2.2) state.targetDispersion = 0;
      else if (cycle < 5.8) state.targetDispersion = smoothstep(0, 1, (cycle - 2.2) / 3.6);
      else if (cycle < 7.3) state.targetDispersion = 1;
      else if (cycle < 10.4) state.targetDispersion = 1 - smoothstep(0, 1, (cycle - 7.3) / 3.1);
      else state.targetDispersion = 0;
    } else if (state.mode === "camera" && !state.handPresent) {
      if (state.noHandSince && elapsed * 1000 - state.lastHandSeen > 900) {
        state.targetDispersion += (0 - state.targetDispersion) * (1 - Math.exp(-delta * 1.0));
      }
    }

    const k = 1 - Math.exp(-delta * (state.mode === "camera" ? 13.0 : 8.0));
    state.dispersion += (state.targetDispersion - state.dispersion) * k;
    if (Math.abs(state.targetDispersion - state.dispersion) < 0.0005) state.dispersion = state.targetDispersion;

    updateSolid(state.dispersion);
    if (dissolveMaterial) {
      dissolveMaterial.uniforms.uDispersion.value = state.dispersion;
      dissolveMaterial.uniforms.uTime.value = elapsed;
    }
    if (dissolveHazeMaterial) dissolveHazeMaterial.uniforms.uDispersion.value = state.dispersion;
    if (goldMaterial) goldMaterial.uniforms.uTime.value = elapsed;
    if (bloom) bloom.strength = 0.18 + 0.16 * Math.sin(Math.PI * clamp(state.dispersion));
    updateHud();
    composer.render(delta);

    if (firstFrame) {
      firstFrame = false;
      loader?.classList.add("is-done");
      if (!initialModeStarted) {
        initialModeStarted = true;
        if (params.has("demo")) enterAuto(true);
        else if (params.has("pointer")) startPointer();
        else if (fixedDispersion === null) showGate();
      }
      window.__rosesReady = true;
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  if (hud) hud.hidden = true;
  window.__roseGesture = {
    scene, camera, composer, bouquet, state,
    setDispersion: (value) => {
      state.targetDispersion = clamp(value);
      state.dispersion = state.targetDispersion;
    },
    setMode: (mode) => {
      if (mode === "auto") enterAuto(true);
      else if (mode === "pointer") startPointer();
    },
    get mode() { return state.mode; },
    get ready() { return window.__rosesReady === true; },
  };
}

boot().catch(showError);
