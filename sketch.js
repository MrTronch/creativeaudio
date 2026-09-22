// Main coordinator: canvas, shared input, mode lifecycle and transitions.
window.APP = {
  mode: 1,
  touchInputUsed: false,
  touchVoices: [],
  touchAssignments: new Map(),
  tapCandidate: null,
  currentTap: null,
  multiTouchGesture: false,
  params: {
    shapeSize: 1,
    influenceRadius: 280,
    motionReactivity: 1,
    audioNoise: 0.16,
    pitch: 0,
    trailPersistence: 5
  },
  interaction: null,
  targetInteraction: null,
  previousInput: null,
  inputActive: false,
  hasInteracted: false,
  lastInputTime: 0,
  audioIdleTimeout: 2000,
  gestureSpeed: 0,
  motionEnergy: 0,
  motionAccumulator: 0,
  previousVelocityX: 0,
  previousVelocityY: 0,
  transitionSnapshot: null,
  transitionStart: -1000,
  transitionDuration: 480,
  modeMessageUntil: 0,
  lastTapTime: 0,
  lastTapX: 0,
  lastTapY: 0,
  paletteSwapped: false,
  paletteMix: 0,
  paletteTransitionFrom: 0,
  paletteTransitionStart: -1000,
  paletteTransitionDuration: 1000,
  centerLatch: false,
  lastCenterToggle: -2000,
  centerToggleCooldown: 2000,
  centerPulseStart: -1000
};

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-container");
  canvas.elt.addEventListener("pointerup", handleDoubleGesture);
  canvas.elt.addEventListener("pointermove", event => {
    if (event.pointerType === "mouse" && !APP.touchAssignments.size) APP.touchInputUsed = false;
  });
  canvas.elt.addEventListener("touchcancel", cancelTouchInput);
  canvas.elt.addEventListener("touchforcechange", event => {
    for (const touch of event.changedTouches) {
      const voice = APP.touchAssignments.get(touch.identifier);
      if (voice) updateTouchPressure(voice, touch);
    }
  });
  window.addEventListener("blur", cancelTouchInput);
  pixelDensity(min(window.devicePixelRatio || 1, 1.5));
  APP.interaction = createVector(width / 2, height / 2);
  APP.targetInteraction = APP.interaction.copy();
  APP.previousInput = APP.interaction.copy();
  APP.touchVoices = [createTouchVoice(), createTouchVoice()];
  Mode1.init();
  Mode2.init();
  UI.init();
  Mode1.enter();
  strokeCap(ROUND);
  strokeJoin(ROUND);
}

function draw() {
  updateGlobalInput();
  updateCenterPaletteSwap();

  if (APP.mode === 1) {
    runModeSafely("MODE 1", () => {
      Mode1.update();
      Mode1.draw();
    });
  } else {
    runModeSafely("MODE 2", () => {
      Mode2.update();
      Mode2.draw();
    });
  }

  // Audio errors never stop visual rendering.
  try {
    AudioEngine.update(APP);
  } catch (error) {
    console.error("AUDIO ERROR:", error);
  }

  drawModeTransition();
  drawModeLabel();
}

function runModeSafely(label, renderMode) {
  try {
    renderMode();
  } catch (error) {
    console.error(label + " ERROR:", error);
    background(28);
    fill(255, 90, 90);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(16);
    text(label + " ERROR — revisa la consola", width / 2, height / 2);
  }
}
function getInputPosition() {
  let x = mouseX, y = mouseY, active = false;
  if (touches.length) {
    x = touches[0].x;
    y = touches[0].y;
    active = !pointIsOverUI(x, y);
  } else {
    const inside = x >= 0 && x <= width && y >= 0 && y <= height;
    active = inside && (movedX !== 0 || movedY !== 0 || mouseIsPressed) && !pointIsOverUI(x, y);
  }
  return { x, y, active };
}

function updateGlobalInput() {
  if (!APP.touchInputUsed) {
    updateInputState(APP, getInputPosition());
    return;
  }
  for (const voice of APP.touchVoices) {
    voice.mode = APP.mode;
    voice.params = APP.params;
    updateInputState(voice, { x: voice.x, y: voice.y, active: voice.active });
    if (voice.active) voice.lastInputTime = millis();
  }
  const primary = APP.touchVoices.find(voice => voice.active);
  APP.inputActive = Boolean(primary);
  if (primary) {
    APP.interaction.set(primary.interaction);
    APP.targetInteraction.set(primary.targetInteraction);
    APP.gestureSpeed = primary.gestureSpeed;
    APP.motionEnergy = primary.motionEnergy;
    APP.hasInteracted = true;
    APP.lastInputTime = millis();
  } else {
    APP.gestureSpeed *= 0.75;
    APP.motionEnergy *= 0.96;
  }
}

function updateInputState(state, input) {
  const frameScale = 16.667 / max(deltaTime, 8);
  let speedTarget = 0, agitation = 0;

  if (input.active) {
    const x = constrain(input.x, 0, width), y = constrain(input.y, 0, height);
    const vx = (x - state.previousInput.x) * frameScale;
    const vy = (y - state.previousInput.y) * frameScale;
    const speed = sqrt(vx * vx + vy * vy);
    const oldSpeed = sqrt(state.previousVelocityX ** 2 + state.previousVelocityY ** 2);
    speedTarget = speed / (speed + 24);
    updateCircleGesture(state, vx, vy, speed);

    if (speed > 1 && oldSpeed > 1) {
      const dot = constrain((vx * state.previousVelocityX + vy * state.previousVelocityY) / (speed * oldSpeed), -1, 1);
      agitation = (1 - dot) * 0.5 * speedTarget;
    }

    state.motionAccumulator = constrain(state.motionAccumulator * 0.91 + speedTarget * 0.11 + agitation * 0.2, 0, 1);
    state.previousVelocityX = vx;
    state.previousVelocityY = vy;
    state.targetInteraction.set(x, y);
    state.previousInput.set(x, y);
    state.inputActive = true;
    state.hasInteracted = true;
    if (speed > 0.35) state.lastInputTime = millis();
  } else {
    updateCircleGesture(state, 0, 0, 0);
    state.inputActive = false;
    state.motionAccumulator *= 0.955;
    state.previousVelocityX *= 0.72;
    state.previousVelocityY *= 0.72;
  }

  state.gestureSpeed = lerp(state.gestureSpeed, speedTarget, 0.25);
  const targetEnergy = constrain(
    (state.gestureSpeed * 0.72 + state.motionAccumulator * 0.55 + agitation * 0.3) *
    state.params.motionReactivity,
    0,
    1
  );
  state.motionEnergy = lerp(state.motionEnergy, targetEnergy, targetEnergy > state.motionEnergy ? 0.34 : 0.04);
  state.interaction.lerp(state.targetInteraction, state.mode === 1 ? 0.46 : 0.52);
}

function updateCenterPaletteSwap() {
  APP.paletteTransitionDuration = Mode1.CENTER_SWAP_DURATION;
  APP.centerToggleCooldown = Mode1.CENTER_SWAP_COOLDOWN;
  const targetMix = APP.paletteSwapped ? 1 : 0;
  const transitionProgress = constrain(
    (millis() - APP.paletteTransitionStart) / APP.paletteTransitionDuration,
    0,
    1
  );
  APP.paletteMix = lerp(
    APP.paletteTransitionFrom,
    targetMix,
    smoothStep01(transitionProgress)
  );

  const centerRadius = Mode1.CENTER_TRIGGER_RADIUS;
  const inside = APP.inputActive &&
    dist(APP.interaction.x, APP.interaction.y, width / 2, height / 2) < centerRadius;
  const cooldownReady = millis() - APP.lastCenterToggle >= APP.centerToggleCooldown;

  if (inside && !APP.centerLatch && cooldownReady) {
    APP.paletteTransitionFrom = APP.paletteMix;
    APP.paletteSwapped = !APP.paletteSwapped;
    APP.paletteTransitionStart = millis();
    APP.centerLatch = true;
    APP.lastCenterToggle = millis();
    APP.centerPulseStart = millis();
  }
  if (!inside) APP.centerLatch = false;
}
function pointIsOverUI(x, y) {
  const element = document.elementFromPoint(x, y);
  return Boolean(element && element.closest(".controls"));
}

function handleDoubleGesture(event) {
  if (event.pointerType !== "mouse") return;
  const now = millis();
  const close = dist(event.clientX, event.clientY, APP.lastTapX, APP.lastTapY) < 48;
  if (APP.lastTapTime > 0 && now - APP.lastTapTime < 300 && close) {
    changeMode();
    APP.lastTapTime = 0;
  } else {
    APP.lastTapTime = now;
    APP.lastTapX = event.clientX;
    APP.lastTapY = event.clientY;
  }
}

function changeMode() {
  APP.transitionSnapshot = get();
  APP.transitionStart = millis();
  if (APP.mode === 1) {
    Mode1.exit();
    APP.mode = 2;
    AudioEngine.setActiveMode(2);
    Mode2.enter();
  } else {
    Mode2.exit();
    APP.mode = 1;
    AudioEngine.setActiveMode(1);
    Mode1.enter();
  }
  APP.modeMessageUntil = millis() + 1050;
}

function drawModeTransition() {
  const progress = (millis() - APP.transitionStart) / APP.transitionDuration;
  if (!APP.transitionSnapshot || progress >= 1) {
    APP.transitionSnapshot = null;
    return;
  }
  tint(255, 255 * (1 - smoothStep01(progress)));
  image(APP.transitionSnapshot, 0, 0, width, height);
  noTint();
}

function drawModeLabel() {
  if (millis() > APP.modeMessageUntil) return;
  const alpha = constrain((APP.modeMessageUntil - millis()) / 280, 0, 1) * 180;
  fill(APP.mode === 1 ? color(242, alpha) : color(20, alpha));
  noStroke();
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(min(width, height) * 0.023);
  text(APP.mode === 1 ? "MODE 1 — ISO HEAT" : "MODE 2 — PULSE", width / 2, height * 0.12);
}

function smoothStep01(value) {
  const t = constrain(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  APP.interaction.set(constrain(APP.interaction.x, 0, width), constrain(APP.interaction.y, 0, height));
  APP.targetInteraction.set(APP.interaction);
  APP.previousInput.set(APP.interaction);
  Mode1.resize();
  Mode2.init();
}

function createTouchVoice() {
  return {
    spinEnergy: 0, circleTurn: 0, circleVX: 0, circleVY: 0,
    identifier: null, active: false, x: width / 2, y: height / 2,
    pressure: 0, pressureMin: 1, pressureMax: 0, pressureAvailable: false,
    interaction: createVector(width / 2, height / 2),
    targetInteraction: createVector(width / 2, height / 2),
    previousInput: createVector(width / 2, height / 2),
    inputActive: false, hasInteracted: false, lastInputTime: 0,
    gestureSpeed: 0, motionEnergy: 0, motionAccumulator: 0,
    previousVelocityX: 0, previousVelocityY: 0,
    mode: APP.mode, params: APP.params, lastVisualPulse: -1000
  };
}

function touchPosition(touch) {
  const bounds = document.querySelector("canvas").getBoundingClientRect();
  return { x: (touch.clientX - bounds.left) * width / bounds.width,
    y: (touch.clientY - bounds.top) * height / bounds.height };
}

function cancelDoubleTap() {
  APP.tapCandidate = null;
  APP.currentTap = null;
}

function touchStarted(event) {
  if (!event) return true;
  if (event.touches.length > 1) {
    APP.multiTouchGesture = true;
    cancelDoubleTap();
  }
  for (const touch of event.changedTouches) {
    if (touch.target.closest(".controls")) { cancelDoubleTap(); continue; }
    const voice = APP.touchVoices.find(item => !item.active);
    if (!voice) continue;
    const position = touchPosition(touch);
    Object.assign(voice, createTouchVoice(), position,
      { active: true, identifier: touch.identifier, hasInteracted: true, lastInputTime: millis() });
    updateTouchPressure(voice, touch);
    voice.interaction.set(position.x, position.y);
    voice.targetInteraction.set(position.x, position.y);
    voice.previousInput.set(position.x, position.y);
    APP.touchAssignments.set(touch.identifier, voice);
    APP.touchInputUsed = true;
    if (event.touches.length === 1 && !APP.multiTouchGesture) {
      const previous = APP.tapCandidate;
      APP.currentTap = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY,
        start: millis(), second: Boolean(previous && millis() - previous.end <= 300 &&
          dist(touch.clientX, touch.clientY, previous.x, previous.y) < 48) };
      APP.tapCandidate = null;
    }
  }
  return Boolean(event.target.closest(".controls"));
}

function touchMoved(event) {
  if (!event) return true;
  for (const touch of event.changedTouches) {
    const voice = APP.touchAssignments.get(touch.identifier);
    if (voice) {
      Object.assign(voice, touchPosition(touch));
      updateTouchPressure(voice, touch);
    }
    const tap = APP.currentTap;
    if (tap && tap.identifier === touch.identifier && dist(touch.clientX, touch.clientY, tap.x, tap.y) >= 48) cancelDoubleTap();
  }
  return Boolean(event.target.closest(".controls"));
}

function touchEnded(event) {
  if (!event) return true;
  for (const touch of event.changedTouches) {
    const voice = APP.touchAssignments.get(touch.identifier);
    if (voice) {
      Object.assign(voice, { active: false, inputActive: false, hasInteracted: false, identifier: null });
      APP.touchAssignments.delete(touch.identifier);
    }
    const tap = APP.currentTap;
    if (tap && tap.identifier === touch.identifier && !APP.multiTouchGesture && event.touches.length === 0) {
      if (millis() - tap.start <= 300 && dist(touch.clientX, touch.clientY, tap.x, tap.y) < 48) {
        if (tap.second) { cancelDoubleTap(); changeMode(); }
        else APP.tapCandidate = { end: millis(), x: touch.clientX, y: touch.clientY };
      } else APP.tapCandidate = null;
      APP.currentTap = null;
    }
  }
  if (!event.touches.length) APP.multiTouchGesture = false;
  return Boolean(event.target.closest(".controls"));
}

function cancelTouchInput() {
  cancelDoubleTap();
  APP.multiTouchGesture = false;
  APP.touchAssignments.clear();
  for (const voice of APP.touchVoices) {
    Object.assign(voice, { active: false, inputActive: false, hasInteracted: false, identifier: null });
  }
  APP.inputActive = false;
  APP.hasInteracted = false;
  if (window.AudioEngine) AudioEngine.silence();
}

function updateTouchPressure(voice, touch) {
  const pressure = Number(touch.force);
  if (!Number.isFinite(pressure) || pressure <= 0) { voice.pressure = 0; return; }
  voice.pressure = constrain(pressure, 0, 1);
  voice.pressureMin = Math.min(voice.pressureMin, voice.pressure);
  voice.pressureMax = Math.max(voice.pressureMax, voice.pressure);
  // Fixed placeholder force values must not flatten the movement dynamics.
  voice.pressureAvailable = voice.pressureMax - voice.pressureMin > 0.04;
}

// Curvature must keep its direction: straight motion and sharp zigzags do not spin.
function updateCircleGesture(state, vx, vy, speed) {
  const dt = constrain(deltaTime / 1000, 0.008, 0.1);
  if (speed <= 1.5) {
    state.circleIdle = (state.circleIdle || 0) + dt;
    if (state.circleIdle > 0.1) {
      state.circleVX = state.circleVY = 0;
      state.circleTurn = 0;
      state.spinEnergy = (state.spinEnergy || 0) * Math.exp(-dt / 0.22);
    }
    return;
  }
  const sampleDt = dt + (state.circleIdle || 0);
  state.circleIdle = 0;
  const oldX = state.circleVX || 0, oldY = state.circleVY || 0;
  let turn = (state.circleTurn || 0) * Math.exp(-dt / 0.7);
  let target = 0;
  if (speed > 1.5 && Math.hypot(oldX, oldY) > 1.5) {
    const angle = Math.atan2(oldX * vy - oldY * vx, oldX * vx + oldY * vy);
    if (Math.abs(angle) < 1.15) {
      if (angle * turn < 0) turn *= 0.2;
      turn += angle;
      target = constrain((Math.abs(angle) / sampleDt - 0.7) / 7, 0, 1) * constrain(Math.abs(turn) / 1.2, 0, 1);
    } else turn = 0;
  }
  state.circleVX = vx; state.circleVY = vy; state.circleTurn = turn;
  state.spinEnergy = lerp(state.spinEnergy || 0, target, 1 - Math.exp(-dt / (target > (state.spinEnergy || 0) ? 0.09 : 0.22)));
}
