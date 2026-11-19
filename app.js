const FRAME_COUNT = 50;
const FRAME_URLS = Array.from(
  { length: FRAME_COUNT },
  (_, index) => `assets/frames/frame-${String(index + 1).padStart(2, "0")}.webp`
);

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

// Landmarks taken from a front-facing open palm (MediaPipe Hand Landmarker).
// They give the pointer preview authentic finger proportions instead of an
// invented hand illustration. The closed pose brings the fingertips and thumb
// together into a pinched, quiet hand.
const OPEN_HAND = [
  [0.5596, 0.9011], [0.3595, 0.8083], [0.2320, 0.6633], [0.1672, 0.5471], [0.1096, 0.4614],
  [0.4538, 0.4534], [0.4277, 0.3014], [0.4223, 0.2107], [0.4201, 0.1345],
  [0.5845, 0.4456], [0.5941, 0.2777], [0.6058, 0.1811], [0.6212, 0.1060],
  [0.6969, 0.4784], [0.7240, 0.3200], [0.7421, 0.2320], [0.7614, 0.1580],
  [0.8012, 0.5421], [0.8564, 0.4224], [0.8841, 0.3529], [0.9111, 0.2865]
];

const CLOSED_HAND = [
  [0.5596, 0.9011], [0.3800, 0.7900], [0.3300, 0.6800], [0.3050, 0.5500], [0.3000, 0.4460],
  [0.4538, 0.4534], [0.4000, 0.3450], [0.3500, 0.3850], [0.3100, 0.4400],
  [0.5845, 0.4456], [0.5941, 0.2777], [0.6058, 0.1811], [0.6212, 0.1060],
  [0.6969, 0.4784], [0.7240, 0.3200], [0.7421, 0.2320], [0.7614, 0.1580],
  [0.8012, 0.5421], [0.8564, 0.4224], [0.8841, 0.3529], [0.9111, 0.2865]
];

const elements = {
  body: document.body,
  canvas: document.getElementById("portraitCanvas"),
  frameCounter: document.getElementById("frameCounter"),
  hudMode: document.getElementById("hudMode"),
  portraitState: document.getElementById("portraitState"),
  portraitStateCn: document.getElementById("portraitStateCn"),
  portraitPercent: document.getElementById("portraitPercent"),
  frameRuler: document.getElementById("frameRuler"),
  stageHint: document.getElementById("stageHint"),
  opennessValue: document.getElementById("opennessValue"),
  openFill: document.getElementById("openFill"),
  openMarker: document.getElementById("openMarker"),
  expressionText: document.getElementById("expressionText"),
  topStatus: document.getElementById("topStatus"),
  topStatusText: document.getElementById("topStatusText"),
  cameraCard: document.getElementById("cameraCard"),
  cameraIdleText: document.getElementById("cameraIdleText"),
  cameraBadge: document.getElementById("cameraBadge"),
  trackerStats: document.getElementById("trackerStats"),
  cameraError: document.getElementById("cameraError"),
  cameraFallbackBtn: document.getElementById("cameraFallbackBtn"),
  webglWarning: document.getElementById("webglWarning"),
  webcam: document.getElementById("webcam"),
  handCanvas: document.getElementById("handCanvas"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  footerInstruction: document.getElementById("footerInstruction"),
  pointerModeBtn: document.getElementById("pointerModeBtn"),
  startBtn: document.getElementById("startBtn"),
  skipBtn: document.getElementById("skipBtn"),
  gateMessage: document.getElementById("gateMessage"),
  toast: document.getElementById("toast")
};

const ctx = elements.canvas.getContext("2d", { alpha: false });
const handCtx = elements.handCanvas.getContext("2d");
const detectionCanvas = document.createElement("canvas");
detectionCanvas.width = 640;
detectionCanvas.height = 480;
const detectionCtx = detectionCanvas.getContext("2d", { willReadFrequently: false });
const root = document.documentElement;

const state = {
  mode: "gate",
  targetOpenness: 1,
  openness: 1,
  rawOpenness: null,
  frames: [],
  framesReady: false,
  entered: false,
  starting: false,
  cameraReady: false,
  handPresent: false,
  lastHandAt: 0,
  handSeenOnce: false,
  lastDrawnPosition: -1,
  lastInteger: -1,
  lastFrameIndex: -1,
  lastBand: "smile",
  lastTick: -1,
  accent: [230, 183, 131],
  glow: [226, 167, 105],
  toastTimer: 0,
  pointerBound: false,
  delegate: null,
  detectionSamples: 0,
  detectionWindowStart: 0,
  trackerErrorShown: false,
  webgl: true
};

let cameraStream = null;
let handLandmarker = null;
let detectionFrame = 0;
let visionModulePromise = null;

class LowPassFilter {
  constructor() {
    this.value = null;
  }

  filter(value, alpha) {
    this.value = this.value === null ? value : alpha * value + (1 - alpha) * this.value;
    return this.value;
  }
}

class OneEuroFilter {
  constructor(minCutoff = 1.2, beta = 0.065, derivativeCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.x = new LowPassFilter();
    this.dx = new LowPassFilter();
    this.lastTime = null;
    this.lastValue = null;
  }

  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, time) {
    if (this.lastTime === null) {
      this.lastTime = time;
      this.lastValue = value;
      this.x.filter(value, 1);
      return value;
    }

    let dt = time - this.lastTime;
    if (dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.1);

    const derivative = (value - this.lastValue) / dt;
    const filteredDerivative = this.dx.filter(derivative, this.alpha(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const result = this.x.filter(value, this.alpha(cutoff, dt));

    this.lastTime = time;
    this.lastValue = value;
    return result;
  }
}

const opennessFilter = new OneEuroFilter();

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function rgbArray(color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function rgbaArray(color, alpha) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function distance3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distance2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize3(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function detectWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch (error) {
    return false;
  }
}

function showCameraFallback(show) {
  if (elements.cameraFallbackBtn) elements.cameraFallbackBtn.hidden = !show;
}

function showToast(message, duration = 3400) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function setTopStatus(text, tone = "idle") {
  elements.topStatusText.textContent = text;
  elements.topStatus.dataset.tone = tone;
}

function setCameraState(mode, badge) {
  elements.cameraCard.dataset.state = mode;
  elements.cameraBadge.textContent = badge;
}

function setGateMessage(text, tone = "error") {
  elements.gateMessage.textContent = text;
  elements.gateMessage.dataset.tone = tone;
}

function createFrameRuler() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const tick = document.createElement("span");
    tick.setAttribute("aria-hidden", "true");
    fragment.appendChild(tick);
  }
  elements.frameRuler.appendChild(fragment);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // Do not make boot depend on decode() settling. Some browsers can leave a
      // detached decode promise pending; the canvas will decode on first draw.
      if (typeof image.decode === "function") image.decode().catch(() => {});
      resolve(image);
    };
    image.onerror = () => reject(new Error(`无法载入表情帧：${url}`));
    image.src = url;
  });
}

async function preloadFrames() {
  if (state.framesReady) return;
  const results = await Promise.allSettled(FRAME_URLS.map(loadImage));
  const frames = [];
  for (const result of results) {
    if (result.status === "fulfilled") frames.push(result.value);
  }
  if (!frames.length) throw new Error("表情素材载入失败");
  state.frames = frames;
  state.framesReady = true;
  drawPortrait(opennessToPosition(state.openness), true);
}

function opennessToPosition(openness) {
  // Openness 1 -> the first frame (smile). Openness 0 -> the last frame (serious).
  return clamp(1 - openness) * (state.frames.length - 1 || FRAME_COUNT - 1);
}

function drawPortrait(position, force = false) {
  if (!state.framesReady) return;
  if (!force && Math.abs(position - state.lastDrawnPosition) < 0.0008) return;

  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, state.frames.length - 1);
  const mixAmount = position - lower;

  ctx.globalAlpha = 1;
  ctx.drawImage(state.frames[lower], 0, 0, width, height);

  if (mixAmount > 0.002 && upper !== lower) {
    ctx.globalAlpha = mixAmount;
    ctx.drawImage(state.frames[upper], 0, 0, width, height);
  }

  ctx.globalAlpha = 1;
  state.lastDrawnPosition = position;
}

function resolveBand(openness) {
  if (state.lastBand === "smile") {
    if (openness > 0.56) return "smile";
  } else if (openness >= 0.64) {
    return "smile";
  }

  if (state.lastBand === "serious") {
    if (openness < 0.25) return "serious";
  } else if (openness <= 0.17) {
    return "serious";
  }

  return "between";
}

const BANDS = {
  smile: {
    portrait: "SMILE",
    chinese: "笑意正浓",
    expression: "A SMILE",
    footer: "很好。现在，慢慢收拢手指。"
  },
  between: {
    portrait: "BETWEEN",
    chinese: "神情渐缓",
    expression: "IN BETWEEN",
    footer: "保持这种感觉。继续张开，或慢慢捏合。"
  },
  serious: {
    portrait: "SERIOUS",
    chinese: "笑意已收",
    expression: "SERIOUS",
    footer: "现在，缓慢张开手掌，让笑意回来。"
  }
};

function updateVisualState(openness, force = false) {
  const position = opennessToPosition(openness);
  const percent = Math.round(openness * 100);
  const frameIndex = Math.round(position);
  const band = resolveBand(openness);

  drawPortrait(position, force);
  root.style.setProperty("--p", openness.toFixed(4));

  if (force || percent !== state.lastInteger) {
    const padded = String(percent).padStart(3, "0");
    elements.opennessValue.textContent = padded;
    elements.portraitPercent.textContent = padded;
    elements.openFill.style.transform = `scaleX(${openness})`;
    elements.openMarker.style.left = `${openness * 100}%`;
    state.lastInteger = percent;

    const accent = [
      Math.round(mix(131, 230, openness)),
      Math.round(mix(157, 183, openness)),
      Math.round(mix(174, 131, openness))
    ];
    const glow = [
      Math.round(mix(102, 228, openness)),
      Math.round(mix(130, 170, openness)),
      Math.round(mix(151, 104, openness))
    ];
    state.accent = accent;
    state.glow = glow;
    root.style.setProperty("--accent", rgbArray(accent));
    root.style.setProperty("--accent-rgb", accent.join(", "));
    root.style.setProperty("--glow-rgb", glow.join(", "));
  }

  if (force || frameIndex !== state.lastFrameIndex) {
    elements.frameCounter.textContent = `FRAME ${String(frameIndex + 1).padStart(2, "0")} / ${FRAME_COUNT}`;
    state.lastFrameIndex = frameIndex;
  }

  const tickIndex = Math.round(openness * (FRAME_COUNT - 1));
  if (force || tickIndex !== state.lastTick) {
    Array.from(elements.frameRuler.children).forEach((tick, index) => {
      tick.classList.toggle("is-on", index === tickIndex);
    });
    state.lastTick = tickIndex;
  }

  if (force || band !== state.lastBand) {
    const content = BANDS[band];
    const previousBand = state.lastBand;
    state.lastBand = band;
    elements.portraitState.textContent = content.portrait;
    elements.portraitStateCn.textContent = content.chinese;
    elements.expressionText.textContent = content.expression;
    if (state.entered && state.mode === "camera") {
      elements.footerInstruction.textContent = content.footer;
    }
    if (previousBand !== band && state.entered) {
      elements.portraitState.animate(
        [
          { opacity: 0.35, transform: "translateY(2px)" },
          { opacity: 1, transform: "translateY(0)" }
        ],
        { duration: 260, easing: "cubic-bezier(.16,1,.3,1)" }
      );
    }
  }
}

function setTargetOpenness(value, immediate = false) {
  state.targetOpenness = clamp(value);
  if (immediate) {
    state.openness = state.targetOpenness;
    updateVisualState(state.openness, true);
    if (state.mode === "pointer") drawDemoHand(state.openness);
  }
}

function setTrackingUi(present) {
  const isTracking = Boolean(present) && state.mode === "camera";

  elements.stageHint.classList.toggle("is-tracking", isTracking);
  elements.cameraCard.dataset.tracking = isTracking ? "true" : "false";

  if (state.mode === "pointer") {
    setTopStatus("鼠标控制中", "demo");
    elements.stageHint.innerHTML = "<i></i> POINTER CONTROL";
    setCameraState("demo", "POINTER");
    return;
  }

  if (state.mode !== "camera") {
    setTopStatus("等待手势", "idle");
    elements.stageHint.innerHTML = "<i></i> SHOW YOUR HAND";
    return;
  }

  if (isTracking) {
    setTopStatus("手势追踪中", "active");
    elements.stageHint.innerHTML = "<i></i> HAND LOCKED";
    setCameraState("live", "HAND LOCKED");
  } else {
    setTopStatus("未识别到手", "idle");
    elements.stageHint.innerHTML = "<i></i> SHOW YOUR HAND";
    setCameraState("live", "SEARCHING");
  }
}

function enterExperience(mode) {
  state.entered = true;
  state.mode = mode;
  elements.body.classList.remove("is-starting");
  elements.body.classList.add("is-entered");
  elements.pointerModeBtn.hidden = mode === "camera";
  if (mode === "pointer") {
    showCameraFallback(false);
    if (elements.cameraError) {
      elements.cameraError.hidden = true;
      elements.cameraError.textContent = "";
    }
  }
  if (elements.hudMode) {
    elements.hudMode.textContent = mode === "camera" ? "LIVE PORTRAIT" : "SIMULATED PORTRAIT";
  }
  if (mode === "pointer") {
    elements.body.classList.add("pointer-mode");
    const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    elements.footerInstruction.textContent = isCoarsePointer
      ? "在屏幕上左右滑动，控制手掌开合。"
      : "左右移动鼠标，控制手掌开合。";
  }
  setTrackingUi(mode === "camera" ? false : true);
  updateVisualState(state.openness, true);
  if (mode === "camera") {
    elements.footerInstruction.textContent = "先张开手掌让镜头锁定，再慢慢捏合。";
  }
  window.setTimeout(() => {
    if (mode === "camera") {
      showToast("手势已连接。张开手掌，让他微笑。", 3800);
    } else {
      showToast("鼠标演示已开启：左右移动指针，控制表情。", 3800);
    }
  }, 850);
}

function hasCameraSupport() {
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
}

function friendlyCameraError(error) {
  if (!hasCameraSupport()) {
    return "当前页面无法使用摄像头。请通过 localhost 或 HTTPS 打开。";
  }
  switch (error && error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "摄像头权限被拒绝。你仍可以用鼠标体验这段表情。";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "没有找到可用的摄像头，请连接后重试。";
    case "NotReadableError":
    case "TrackStartError":
      return "摄像头正被其他程序占用，请关闭后重试。";
    case "OverconstrainedError":
      return "摄像头无法提供合适的画面，请重试。";
    case "CameraStartError":
      return "摄像头已连接，但浏览器没有传来画面。请关闭其他占用摄像头的应用，或改用 Chrome / Safari 打开本页。";
    default:
      return "连接摄像头时出了点问题。你也可以先用鼠标体验。";
  }
}

async function initCamera() {
  if (!hasCameraSupport()) throw new Error("Camera API unavailable");

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

  // Register listeners before attaching the stream. Some desktop browsers can
  // surface metadata immediately, and a late listener would never resolve.
  const videoReady = new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("error", onError);
    };
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      const error = new Error("Camera video element failed");
      error.name = "CameraStartError";
      reject(error);
    };
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("error", onError);
    timeoutId = window.setTimeout(() => {
      cleanup();
      const error = new Error("Camera stream produced no frames");
      error.name = "CameraStartError";
      reject(error);
    }, 8000);
  });

  video.srcObject = stream;
  video.style.opacity = "0.72";

  // Start playback immediately. Waiting for metadata before calling play() can
  // leave a live MediaStream attached but permanently paused in some browsers.
  video.play().catch((error) => {
    console.warn("[Face / Signal] First camera play attempt was blocked.", error);
  });

  try {
    await videoReady;
    if (video.paused) await video.play();
    if (!video.videoWidth || !video.videoHeight) {
      const error = new Error("Camera video has no dimensions");
      error.name = "CameraStartError";
      throw error;
    }
  } catch (error) {
    stopCamera();
    throw error;
  }

  state.cameraReady = true;
}

async function initHandLandmarker() {
  if (handLandmarker) return handLandmarker;

  if (!visionModulePromise) {
    visionModulePromise = import("./assets/mediapipe/vendor/vision_bundle.mjs").then((module) => {
      window.FilesetResolver = module.FilesetResolver;
      window.HandLandmarker = module.HandLandmarker;
      return module;
    });
  }

  const { FilesetResolver, HandLandmarker } = await visionModulePromise;
  const vision = await FilesetResolver.forVisionTasks(
    new URL("assets/mediapipe/wasm", location.href).href
  );

  // CPU/WASM is deliberately preferred here. The GPU delegate is faster on
  // paper but can initialise successfully and still return no detections on
  // some desktop Chrome/GPU combinations. CPU gives predictable hand tracking
  // at webcam resolutions, which matters more for this interaction.
  const delegate = "CPU";
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: new URL("assets/mediapipe/hand_landmarker.task", location.href).href,
      delegate
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.38,
    minTrackingConfidence: 0.35
  });

  console.info(`[Face / Signal] Hand tracking ready on ${delegate}.`);
  // Keep a local reference used by detection; this also makes the init state explicit.
  window.__faceSignalDelegate = delegate;
  state.delegate = delegate;
  if (elements.trackerStats) elements.trackerStats.textContent = `${delegate} · READY`;
  return handLandmarker;
}

async function beginCameraExperience() {
  if (state.starting || state.entered) return;
  state.starting = true;
  let cameraConnected = false;
  let modelReady = false;

  const updateGateProgress = () => {
    if (!state.starting) return;
    if (cameraConnected && modelReady) {
      setGateMessage("准备完成，正在进入…", "muted");
    } else if (cameraConnected) {
      setGateMessage("摄像头已连接，正在准备本地手势模型…", "muted");
    } else if (modelReady) {
      setGateMessage("手势模型已就绪，正在打开摄像头画面…", "muted");
    } else {
      setGateMessage("正在请求摄像头权限…", "muted");
    }
  };

  elements.startBtn.classList.add("is-loading");
  elements.skipBtn.disabled = true;
  elements.body.classList.add("is-starting");
  setTopStatus("连接中", "idle");
  elements.cameraIdleText.textContent = "REQUESTING CAMERA";
  setCameraState("off", "CONNECTING");
  updateGateProgress();

  const cameraPromise = initCamera().then(() => {
    cameraConnected = true;
    updateGateProgress();
  });
  const modelPromise = initHandLandmarker().then(() => {
    modelReady = true;
    updateGateProgress();
  });

  try {
    await Promise.all([preloadFrames(), cameraPromise, modelPromise]);

    setGateMessage("");
    state.starting = false;
    elements.cameraIdleText.textContent = "CAMERA READY";
    clearDetectionError();
    if (elements.trackerStats) elements.trackerStats.textContent = `${state.delegate || "CPU"} · STARTING`;
    startDetection();
    enterExperience("camera");
  } catch (error) {
    console.error("[Face / Signal] Startup failed", error);
    state.starting = false;
    elements.startBtn.classList.remove("is-loading");
    elements.skipBtn.disabled = false;
    elements.body.classList.remove("is-starting");
    stopCamera();
    setCameraState("off", "STANDBY");
    elements.cameraIdleText.textContent = "CAMERA OFFLINE";
    if (elements.trackerStats) elements.trackerStats.textContent = `${state.delegate || "CPU"} · PAUSED`;
    setTopStatus("未连接", "error");
    setGateMessage(friendlyCameraError(error), "error");
  }
}

function enterPointerMode(options = {}) {
  const { announce = true } = options;
  if (state.starting) return;
  if (state.mode === "pointer" && state.entered) return;

  stopCamera();
  stopDetection();
  state.mode = "pointer";
  state.handPresent = false;
  state.pointerBound = false;
  bindPointerControl();
  drawDemoHand(state.openness);
  enterExperience("pointer");

  if (!announce) {
    elements.toast.classList.remove("is-visible");
  }
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.webcam.srcObject = null;
  state.cameraReady = false;
}

function startDetection() {
  if (!handLandmarker || detectionFrame) return;
  lastDetectionAt = -Infinity;
  detectionFrame = requestAnimationFrame(detectFrame);
}

function stopDetection() {
  if (detectionFrame) cancelAnimationFrame(detectionFrame);
  detectionFrame = 0;
}

let lastDetectionAt = -Infinity;

function displayDetectionError(error) {
  state.trackerErrorShown = true;
  const message = error && (error.message || String(error));
  const detail = message ? String(message).slice(0, 220) : "Unknown MediaPipe error";
  console.error("[Face / Signal] Detection error", error);
  elements.cameraBadge.textContent = "TRACKER ERROR";
  elements.trackerStats.textContent = `${state.delegate || "CPU"} · ERROR`;
  if (elements.cameraError) {
    elements.cameraError.hidden = false;
    if (!state.webgl) {
      elements.cameraError.textContent = "MediaPipe 需要 WebGL，但当前浏览器没有可用的 WebGL 上下文。请开启浏览器图形加速后重启浏览器，或改用 Safari。";
    } else if (/activeTexture|WebGL|webgl/i.test(detail)) {
      elements.cameraError.textContent = "MediaPipe 无法创建 WebGL 纹理。请在 Chrome 设置 → 系统与性能中开启“使用图形加速”，重启浏览器后再试，或改用 Safari。";
    } else {
      elements.cameraError.textContent = `MediaPipe: ${detail}`;
    }
    elements.cameraError.title = message || "";
  }
  showCameraFallback(true);
  setTopStatus("识别异常", "error");
}

function clearDetectionError() {
  if (elements.cameraError && !elements.cameraError.hidden) {
    elements.cameraError.hidden = true;
    elements.cameraError.textContent = "";
  }
  showCameraFallback(false);
}

function detectFrame(now) {
  detectionFrame = requestAnimationFrame(detectFrame);
  if (document.hidden || !cameraStream || !handLandmarker) return;

  const video = elements.webcam;
  if (video.readyState < 2 || !video.videoWidth) return;

  // Do not rely on video.currentTime advancing: some live-stream/video
  // implementations freeze that value while still rendering new frames.
  // A time throttle keeps the detector polling continuously either way.
  if (now - lastDetectionAt < 40) return;
  lastDetectionAt = now;

  try {
    // Snapshot the camera into a fixed 4:3 canvas before inference. Handing a
    // live HTMLVideoElement directly to the CPU/WASM backend is fragile on some
    // Chrome/camera combinations and can throw on every frame.
    const targetWidth = detectionCanvas.width;
    const targetHeight = detectionCanvas.height;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const scale = Math.max(targetWidth / videoWidth, targetHeight / videoHeight);
    const sourceWidth = targetWidth / scale;
    const sourceHeight = targetHeight / scale;
    const sourceX = (videoWidth - sourceWidth) / 2;
    const sourceY = (videoHeight - sourceHeight) / 2;

    detectionCtx.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight
    );

    const result = handLandmarker.detectForVideo(detectionCanvas, now);
    clearDetectionError();
    processHandResult(result, now);

    if (!state.detectionWindowStart) state.detectionWindowStart = now;
    state.detectionSamples += 1;
    if (now - state.detectionWindowStart >= 1000) {
      const fps = Math.round((state.detectionSamples * 1000) / (now - state.detectionWindowStart));
      elements.trackerStats.textContent = `${state.delegate || "CPU"} · ${fps} FPS`;
      state.detectionSamples = 0;
      state.detectionWindowStart = now;
    }
  } catch (error) {
    displayDetectionError(error);
  }
}

function processHandResult(result, now) {
  const normalized = result && result.landmarks && result.landmarks[0];
  const world = result && result.worldLandmarks && result.worldLandmarks[0];

  if (!normalized) {
    if (state.handPresent && now - state.lastHandAt > 180) {
      state.handPresent = false;
      handCtx.clearRect(0, 0, elements.handCanvas.width, elements.handCanvas.height);
      setTrackingUi(false);
      elements.footerInstruction.textContent = "先张开手掌让镜头锁定，再慢慢捏合。";
    } else if (!state.handPresent && state.trackerErrorShown) {
      setTrackingUi(false);
      state.trackerErrorShown = false;
    }
    return;
  }

  state.trackerErrorShown = false;
  const wasPresent = state.handPresent;
  state.lastHandAt = now;
  state.handPresent = true;

  // Update the visible state before drawing. A rendering issue must never make
  // the UI pretend the hand was not found.
  setTrackingUi(true);
  if (!wasPresent) {
    elements.footerInstruction.textContent = "找到了。缓慢开合手掌，观察表情的每一帧。";
  }

  try {
    drawHandSkeleton(normalized);
  } catch (error) {
    console.warn("[Face / Signal] Could not draw hand landmarks", error);
  }

  try {
    // World landmarks give the most stable scale, but fall back to the
    // normalized landmarks if a browser returns an incomplete result.
    const pose = world && world.length >= 21 ? world : normalized;
    const openness = measureOpenness(pose);
    if (Number.isFinite(openness)) {
      state.rawOpenness = openness;
      const filtered = opennessFilter.filter(openness, now / 1000);
      state.targetOpenness = clamp(filtered);
    }
  } catch (error) {
    console.warn("[Face / Signal] Could not measure hand openness", error);
  }

  if (!state.handSeenOnce) {
    state.handSeenOnce = true;
    showToast("找到了。现在，慢慢张开或捏合你的手。", 3400);
  }
}

/**
 * Convert a hand pose to a continuous 0–1 openness value.
 *
 * Two independent cues are combined for the four long fingers:
 *  1. chord-to-bone ratio (how straight each finger is)
 *  2. whether the fingertip points away from the palm (how unfolded it is)
 *
 * A thumb–index pinch acts as a gate, so a pinched hand lands at zero even
 * when the remaining fingers are not fully closed. World landmarks are used
 * because they are metric and less sensitive to perspective distortion.
 */
function measureOpenness(world) {
  const wrist = world[0];
  const palmLength = distance3(wrist, world[9]) || 1e-6;
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

    const boneLength =
      distance3(mcp, pip) + distance3(pip, dip) + distance3(dip, tip);
    const chord = distance3(mcp, tip);
    const straightness = clamp(chord / (boneLength || 1e-6));

    const base = {
      x: mcp.x - wrist.x,
      y: mcp.y - wrist.y,
      z: mcp.z - wrist.z
    };
    const outward = {
      x: tip.x - mcp.x,
      y: tip.y - mcp.y,
      z: tip.z - mcp.z
    };
    const baseDir = normalize3(base);
    const outDir = normalize3(outward);
    const forward = dot3(outDir, baseDir);

    const straightScore = smoothstep(0.56, 0.93, straightness);
    const reachScore = smoothstep(-0.18, 0.82, forward);
    const fingerOpen = clamp(straightScore * 0.7 + reachScore * 0.3);

    extension += fingerOpen * finger.weight;
    weightSum += finger.weight;
  }

  extension /= weightSum || 1;

  const palmWidth = distance3(world[5], world[17]) || palmLength;
  const thumbIndexGap = distance3(world[4], world[8]);
  const pinchRatio = thumbIndexGap / (palmWidth || 1e-6);
  const pinchGate = smoothstep(0.26, 0.92, pinchRatio);

  const raw = extension * (0.12 + 0.88 * pinchGate);
  // A pinch should reach the serious endpoint even when the other fingers stay
  // loosely extended, so the low end of the range is intentionally compressed.
  return clamp((raw - 0.15) / 0.83);
}

function drawHandSkeleton(landmarks) {
  const canvas = elements.handCanvas;
  const width = canvas.width;
  const height = canvas.height;
  const accent = state.accent;
  const stroke = rgbaArray(accent, 0.92);

  handCtx.clearRect(0, 0, width, height);
  handCtx.lineCap = "round";
  handCtx.lineJoin = "round";

  // MediaPipe receives a cover-cropped 4:3 canvas, matching the preview's
  // object-fit: cover. Coordinates therefore map directly, only mirrored.
  const points = landmarks.map((landmark) => ({
    x: (1 - landmark.x) * width,
    y: landmark.y * height
  }));

  if (points.some((point) => point.x < -40 || point.y < -40)) return;

  handCtx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    handCtx.moveTo(points[start].x, points[start].y);
    handCtx.lineTo(points[end].x, points[end].y);
  }
  handCtx.strokeStyle = "rgba(8, 7, 5, 0.42)";
  handCtx.lineWidth = 4.2;
  handCtx.stroke();

  handCtx.strokeStyle = rgbaArray(accent, 0.82);
  handCtx.lineWidth = 2.1;
  handCtx.shadowColor = rgbaArray(accent, 0.42);
  handCtx.shadowBlur = 9;
  handCtx.stroke();
  handCtx.shadowBlur = 0;

  handCtx.beginPath();
  for (const landmark of [0, 4, 8, 12, 16, 20]) {
    const point = points[landmark];
    handCtx.moveTo(point.x + 3.1, point.y);
    handCtx.arc(point.x, point.y, 3.1, 0, Math.PI * 2);
  }
  handCtx.fillStyle = stroke;
  handCtx.shadowColor = "rgba(8, 7, 5, 0.5)";
  handCtx.shadowBlur = 4;
  handCtx.fill();
  handCtx.shadowBlur = 0;

  const palm = [0, 5, 9, 13, 17];
  handCtx.beginPath();
  palm.forEach((index, order) => {
    const point = points[index];
    if (order === 0) handCtx.moveTo(point.x, point.y);
    else handCtx.lineTo(point.x, point.y);
  });
  handCtx.closePath();
  handCtx.fillStyle = rgbaArray(accent, 0.06);
  handCtx.fill();
}

function getMorphedHand(openness) {
  const amount = 1 - clamp(openness);
  return OPEN_HAND.map(([openX, openY], index) => {
    const [closedX, closedY] = CLOSED_HAND[index];
    return {
      x: mix(openX, closedX, amount),
      y: mix(openY, closedY, amount)
    };
  });
}

function mapHandToCanvas(points, canvas) {
  const scale = Math.min(canvas.width, canvas.height) * 0.86;
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  return points.map((point) => ({
    x: centerX + (point.x - 0.51) * scale,
    y: centerY + (point.y - 0.5) * scale
  }));
}

function drawDemoHand(openness) {
  const canvas = elements.handCanvas;
  const width = canvas.width;
  const height = canvas.height;
  const accent = state.accent;
  const points = mapHandToCanvas(getMorphedHand(openness), canvas);

  handCtx.clearRect(0, 0, width, height);
  handCtx.lineCap = "round";
  handCtx.lineJoin = "round";

  // A soft palm shape anchors the skeleton without making it feel like a diagram.
  const palm = [0, 5, 9, 13, 17].map((index) => points[index]);
  handCtx.beginPath();
  palm.forEach((point, index) => {
    if (index === 0) handCtx.moveTo(point.x, point.y);
    else handCtx.lineTo(point.x, point.y);
  });
  handCtx.closePath();
  handCtx.fillStyle = rgbaArray(accent, 0.055);
  handCtx.fill();

  handCtx.beginPath();
  for (const [startIndex, endIndex] of HAND_CONNECTIONS) {
    handCtx.moveTo(points[startIndex].x, points[startIndex].y);
    handCtx.lineTo(points[endIndex].x, points[endIndex].y);
  }
  handCtx.strokeStyle = rgbaArray(accent, 0.55);
  handCtx.lineWidth = 1.6;
  handCtx.stroke();

  handCtx.beginPath();
  for (const point of points) {
    handCtx.moveTo(point.x + 2.1, point.y);
    handCtx.arc(point.x, point.y, 2.1, 0, Math.PI * 2);
  }
  handCtx.fillStyle = rgbaArray(accent, 0.7);
  handCtx.fill();

  handCtx.beginPath();
  for (const tipIndex of [4, 8, 12, 16, 20]) {
    const point = points[tipIndex];
    handCtx.moveTo(point.x + 3.4, point.y);
    handCtx.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
  }
  handCtx.fillStyle = rgbaArray(accent, 0.95);
  handCtx.shadowColor = rgbaArray(accent, 0.45);
  handCtx.shadowBlur = 9;
  handCtx.fill();
  handCtx.shadowBlur = 0;
}

function buildDiagramHands() {
  document.querySelectorAll(".diagram__hand[data-hand-pose]").forEach((svg) => {
    const isOpen = svg.dataset.handPose === "open";
    const pose = getMorphedHand(isOpen ? 1 : 0);
    const scale = 145;
    const points = pose.map((point) => ({
      x: 80 + (point.x - 0.51) * scale,
      y: 80 + (point.y - 0.5) * scale
    }));
    const bonePath = HAND_CONNECTIONS
      .map(([start, end]) => `M${points[start].x.toFixed(1)} ${points[start].y.toFixed(1)}L${points[end].x.toFixed(1)} ${points[end].y.toFixed(1)}`)
      .join("");
    const palm = [0, 5, 9, 13, 17]
      .map((index) => `${points[index].x.toFixed(1)},${points[index].y.toFixed(1)}`)
      .join(" ");
    const joints = points
      .map((point, index) => {
        const isTip = [4, 8, 12, 16, 20].includes(index);
        return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${isTip ? 2.2 : 1.35}" />`;
      })
      .join("");
    svg.innerHTML = `
      <polygon points="${palm}" fill="currentColor" fill-opacity=".045" />
      <path d="${bonePath}" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round" />
      <g fill="currentColor" fill-opacity=".82">${joints}</g>
    `;
  });
}

function bindPointerControl() {
  if (state.pointerBound) return;
  state.pointerBound = true;

  const onPointerMove = (event) => {
    if (state.mode !== "pointer") return;
    const value = clamp(event.clientX / window.innerWidth);
    setTargetOpenness(value);
    elements.stageHint.classList.add("is-tracking");
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerMove, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (state.mode !== "pointer") return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -0.035 : 0.035;
    setTargetOpenness(state.targetOpenness + delta);
  });
}

function renderLoop(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - (renderLoop.lastTime || now)) / 1000));
  renderLoop.lastTime = now;

  const response = state.mode === "pointer" ? 15 : 11;
  const alpha = 1 - Math.exp(-dt * response);
  const delta = state.targetOpenness - state.openness;

  if (Math.abs(delta) > 0.00025) {
    state.openness = clamp(state.openness + delta * alpha);
    if (Math.abs(state.targetOpenness - state.openness) < 0.0003) {
      state.openness = state.targetOpenness;
    }
    updateVisualState(state.openness);
    if (state.mode === "pointer" && state.entered) {
      drawDemoHand(state.openness);
    }
  }

  requestAnimationFrame(renderLoop);
}

function updateFullscreenButton() {
  const isFullscreen = Boolean(document.fullscreenElement);
  elements.fullscreenBtn.setAttribute("aria-label", isFullscreen ? "退出全屏" : "进入全屏");
  elements.fullscreenBtn.title = isFullscreen ? "退出全屏" : "全屏";
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    showToast("当前浏览器不允许进入全屏模式。");
  }
}

function bindEvents() {
  elements.startBtn.addEventListener("click", beginCameraExperience);
  elements.skipBtn.addEventListener("click", () => enterPointerMode());
  elements.pointerModeBtn.addEventListener("click", () => enterPointerMode());
  elements.cameraFallbackBtn.addEventListener("click", () => enterPointerMode());
  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.mode === "camera" && cameraStream) startDetection();
  });

  window.addEventListener("beforeunload", stopCamera);
}

async function boot() {
  createFrameRuler();
  elements.handCanvas.width = 640;
  elements.handCanvas.height = 480;
  state.webgl = detectWebGL();
  if (!state.webgl && elements.webglWarning) {
    elements.webglWarning.hidden = false;
  }

  bindEvents();
  updateFullscreenButton();
  buildDiagramHands();

  try {
    await preloadFrames();
    updateVisualState(1, true);
  } catch (error) {
    console.error(error);
    setGateMessage("表情素材加载失败，请刷新页面重试。", "error");
  }

  requestAnimationFrame(renderLoop);

  // Optional visual/demo mode used by the local test harness.
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.has("demo")) {
    enterPointerMode({ announce: false });
    const initial = Number(parameters.get("openness") ?? "1");
    if (Number.isFinite(initial)) setTargetOpenness(clamp(initial), true);
  }

  window.__faceSignal = {
    setOpenness(value, immediate = false) {
      setTargetOpenness(Number(value), immediate);
    },
    getState() {
      return {
        mode: state.mode,
        openness: state.openness,
        targetOpenness: state.targetOpenness,
        rawOpenness: state.rawOpenness,
        handPresent: state.handPresent,
        frame: Math.round(opennessToPosition(state.openness)) + 1
      };
    },
    enterPointerMode,
    enterCameraExperience: beginCameraExperience
  };
}

boot();
