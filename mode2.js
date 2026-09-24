// MODE 2: 2D vanishing-point tunnel and percussive scale feedback.
const MODE2_MAX_ECHOES = 180;
const MODE2_BACKGROUND_SCALE_RESPONSE = 0.05;
window.Mode2 = {
  init: initMode2,
  enter: onEnterMode2,
  update: updateMode2,
  draw: drawMode2,
  exit: onExitMode2,
  resize() { this.echoes.length = 0; },
  echoes: [],
  noisePatterns: null,
  pushSquare: null,
  pushInputs: new WeakMap(),
  trailHeads: new WeakMap(),
  noiseMix: 0.16,
  focusX: 0.5, focusY: 0.5, activity: 0,
  inverted: false,
  centerLatch: false,
  mainShape: 0,
  lastShapeChange: 0
};

function initMode2() {
  Mode2.echoes.length = 0;
  Mode2.trailHeads = new WeakMap();
  resetMode2PushSquare();
  if (!Mode2.noisePatterns) Mode2.noisePatterns = createMode2NoisePatterns();
}

function onEnterMode2() {
  syncShapeSizeLimit();
  Mode2.trailHeads = new WeakMap();
  resetMode2PushSquare();
  Mode2.echoes.length = 0;
  document.getElementById("panel-title").textContent = "MODE 2 · PULSE";
  document.getElementById("mode-axis-x").textContent = "X: Reverb + Rate";
}

function onExitMode2() {
  Mode2.centerLatch = false;
}

function updateMode2() {
  updateMode2NoiseTexture();
  const inputs = APP.touchInputUsed ? APP.touchVoices : [APP];
  const activeInputs = inputs.filter(input => input.inputActive);
  updateMode2PushSquare(inputs);
  const focusInputs = activeInputs.length ? activeInputs : [APP];
  const follow = 1 - Math.exp(-Math.min(deltaTime, 100) / 140);
  const xTarget = focusInputs.reduce((sum, input) => sum + input.interaction.x, 0) / focusInputs.length / max(width, 1);
  const yTarget = focusInputs.reduce((sum, input) => sum + input.interaction.y, 0) / focusInputs.length / max(height, 1);
  const activity = activeInputs.reduce((peak, input) => max(peak, audioGestureEnergy(input)), 0);
  Mode2.focusX = lerp(Mode2.focusX, xTarget, follow);
  Mode2.focusY = lerp(Mode2.focusY, yTarget, follow);
  Mode2.activity = lerp(Mode2.activity, activity, follow);
  Mode2.noiseMix = lerp(Mode2.noiseMix, APP.params.audioNoise, follow);
  for (const input of inputs) {
    if (!input.inputActive) { Mode2.trailHeads.delete(input); continue; }
    const position = input.interaction;
    const previous = Mode2.trailHeads.get(input);
    const spacing = min(width, height) * 0.075 * APP.params.shapeSize * 0.18;
    if (!previous) onMode2Pulse(input.gestureSpeed, position);
    else {
      const distance = dist(previous.x, previous.y, position.x, position.y);
      if (distance < spacing) continue;
      const steps = min(12, max(1, floor(distance / spacing)));
      for (let step = 1; step <= steps; step++) {
        onMode2Pulse(input.gestureSpeed, { x: lerp(previous.x, position.x, step / steps), y: lerp(previous.y, position.y, step / steps) });
      }
    }
    Mode2.trailHeads.set(input, { x: position.x, y: position.y });
  }
  const now = millis();
  for (let i = Mode2.echoes.length - 1; i >= 0; i--) {
    const echo = Mode2.echoes[i];
    echo.age = constrain((now - echo.born) / echo.lifetime, 0, 1);
    echo.alpha = 1 - smoothStep01(constrain((echo.age - 0.35) / 0.65, 0, 1));
    if (echo.age >= 1) Mode2.echoes.splice(i, 1);
  }
}
function drawMode2() {
  const bg = lerp(241, 18, APP.paletteMix);
  const fg = lerp(18, 240, APP.paletteMix);
  background(bg);
  const unit = min(width, height);
  const sizeT = constrain((APP.params.shapeSize - 0.55) / 1.65, 0, 1);
  const levels = 14;
  const centerX = lerp(width / 2, Mode2.focusX * width, 0.42);
  const centerY = lerp(height / 2, Mode2.focusY * height, 0.42);
  const bendX = (Mode2.focusX - 0.5) * unit * 0.2;
  const bendY = (Mode2.focusY - 0.5) * unit * 0.2;
  const distortion = Mode2.activity * unit * 0.065;
  const backgroundScale = lerp(
    1 - MODE2_BACKGROUND_SCALE_RESPONSE,
    1 + MODE2_BACKGROUND_SCALE_RESPONSE,
    sizeT
  );
  const maxW = width * 0.74 * backgroundScale * (1 + Mode2.noiseMix * 0.08);
  const maxH = height * 0.7 * backgroundScale * (1 + Mode2.noiseMix * 0.08);

  drawMode2Noise(maxW, maxH, bg, fg);
  noFill();
  stroke(bg, 220);
  const lineSize = mode2LineWeight();
  strokeWeight(lineSize);
  const cornerPaths = [[], [], [], []];

  for (let i = 0; i < levels; i++) {
    const t = i / max(levels - 1, 1);
    const scale = pow(t, 1.8);
    const envelope = sin(t * PI);
    const wave = sin(t * PI * 3 + millis() * 0.0018) * distortion * envelope;
    const w = max(0, maxW * scale + wave * t);
    const h = max(0, maxH * scale - wave * t * 0.5);
    const x = lerp(centerX, width / 2, t) + bendX * envelope;
    const y = lerp(centerY, height / 2, t) + bendY * envelope;
    const angle = (Mode2.focusX - 0.5) * 0.24 * envelope + Mode2.activity * 0.08 * sin(t * PI * 2);
    const cosine = cos(angle), sine = sin(angle);
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    stroke(bg, lerp(70, 225, t));
    strokeWeight(lineSize * lerp(0.35, 1.15, t));
    beginShape();
    for (let corner = 0; corner < corners.length; corner++) {
      const [dx, dy] = corners[corner];
      const px = x + dx * cosine - dy * sine;
      const py = y + dx * sine + dy * cosine;
      vertex(px, py);
      cornerPaths[corner].push([px, py]);
    }
    endShape(CLOSE);
  }
  stroke(bg, 180);
  strokeWeight(lineSize * 0.7);

  for (const path of cornerPaths) {
    beginShape();
    for (const point of path) vertex(point[0], point[1]);
    endShape();
  }

  stroke(128, 180);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    line(centerX, centerY, width * t, 0);
    line(centerX, centerY, width * t, height);
  }

  drawMode2Echoes(unit, fg);
  drawMode2Input(unit, fg);
  drawMode2PushSquare();
}

function onMode2Pulse(speed, position = APP.interaction) {
  if (APP.mode !== 2) return;
  if (Mode2.echoes.length >= MODE2_MAX_ECHOES) Mode2.echoes.shift();
  const trailT = constrain((APP.params.trailPersistence - 1) / 9, 0, 1);
  Mode2.echoes.push({ x: position.x, y: position.y,
    diameter: min(width, height) * 0.075 * APP.params.shapeSize,
    born: millis(), lifetime: lerp(550, 2500, trailT), age: 0, alpha: 1 });
}

function drawMode2Echoes() {
  for (const echo of Mode2.echoes) {
    fill(255 * (1 - echo.age), echo.alpha * 255);
    stroke(20, echo.alpha * 150);
    strokeWeight(mode2LineWeight() * 0.7);
    circle(echo.x, echo.y, echo.diameter);
  }
}
function drawMode2Input(unit, foreground) {
  const inputs = APP.touchInputUsed ? APP.touchVoices.filter(voice => voice.active) : [APP];
  for (const input of inputs) {
    push();
    translate(input.interaction.x, input.interaction.y);
    fill(255);
    stroke(20);
    strokeWeight(mode2LineWeight() * 0.7);
    drawMode2Shape(0, unit * 0.075 * APP.params.shapeSize, true);
    pop();
  }
}

function drawMode2Shape(type, size, filled) {
  rectMode(CENTER);
  if (!filled) noFill();
  if (type === 0) circle(0, 0, size);
  else if (type === 1) rect(0, 0, size, size);
  else triangle(0, -size * 0.58, size * 0.52, size * 0.42, -size * 0.52, size * 0.42);
}

// Periodic spatial fields interpolate through Z, refreshed at 24 fps.
function createMode2NoiseField(size) {
  const lattices = [32, 64].map(n => ({ n, values: Float32Array.from({ length: n * n }, () => Math.random()) }));
  const sample = (grid, x, y) => {
    const gx = x * grid.n / size, gy = y * grid.n / size;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const tx = smoothStep01(gx - ix), ty = smoothStep01(gy - iy);
    const at = (dx, dy) => grid.values[((iy + dy) % grid.n) * grid.n + (ix + dx) % grid.n];
    return lerp(lerp(at(0, 0), at(1, 0), tx), lerp(at(0, 1), at(1, 1), tx), ty);
  };
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    field[y * size + x] = sample(lattices[0], x, y) * 0.75 + sample(lattices[1], x, y) * 0.25;
  }
  return field;
}

function createMode2NoisePatterns() {
  const size = 256;
  Mode2.noiseState = { size, current: createMode2NoiseField(size), next: createMode2NoiseField(size),
    start: millis(), step: 0, frame: -1, updates: 0,
    tiles: [0, 255].map(shade => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d");
      const pixels = context.createImageData(size, size);
      for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
      return { canvas, context, pixels };
    }) };
  updateMode2NoiseTexture();
  return Mode2.noisePatterns;
}

function updateMode2NoiseTexture() {
  const state = Mode2.noiseState;
  if (!state) return;
  const elapsed = (millis() - state.start) / 1000;
  const frame = Math.floor(elapsed * 24);
  if (frame === state.frame) return;
  state.frame = frame;
  state.updates++;
  const z = frame / 24 * 0.7;
  const step = Math.floor(z);
  if (step !== state.step) {
    state.current = state.next;
    state.next = createMode2NoiseField(state.size);
    state.step = step;
  }
  const blend = smoothStep01(z - step);
  for (let i = 0; i < state.current.length; i++) {
    // Normalize contrast so the grain does not disappear halfway between fields.
    const value = 0.5 + (lerp(state.current[i], state.next[i], blend) - 0.5) / Math.sqrt((1 - blend) ** 2 + blend ** 2);
    const alpha = smoothStep01(constrain((value - 0.53) / 0.09, 0, 1)) * 255;
    for (const tile of state.tiles) tile.pixels.data[i * 4 + 3] = alpha;
  }
  Mode2.noisePatterns = state.tiles.map(tile => {
    tile.context.putImageData(tile.pixels, 0, 0);
    return drawingContext.createPattern(tile.canvas, "repeat");
  });
}

function drawMode2Noise(tunnelWidth, tunnelHeight, bg, fg) {
  const context = drawingContext;
  const grainScale = lerp(0.65, 2.2, constrain(APP.params.motionReactivity / 2, 0, 1));
  const paintPattern = (pattern, alpha) => {
    context.save();
    context.globalAlpha = alpha;
    context.scale(grainScale, grainScale);
    context.fillStyle = pattern;
    context.fillRect(0, 0, width / grainScale, height / grainScale);
    context.restore();
  };
  paintPattern(Mode2.noisePatterns[APP.paletteMix < 0.5 ? 0 : 1], 0.8);
  context.fillStyle = `rgb(${fg},${fg},${fg})`;
  const left = (width - tunnelWidth) / 2, top = (height - tunnelHeight) / 2;
  context.fillRect(left, top, tunnelWidth, tunnelHeight);
  context.save();
  context.beginPath();
  context.rect(left, top, tunnelWidth, tunnelHeight);
  context.clip();
  const inputs = APP.touchInputUsed ? APP.touchVoices.filter(input => input.active) : APP.inputActive ? [APP] : [];
  for (const input of inputs) {
    for (let ring = 4; ring >= 1; ring--) {
      context.save();
      context.beginPath();
      context.arc(input.interaction.x, input.interaction.y, APP.params.influenceRadius * ring / 7, 0, Math.PI * 2);
      context.clip();
      paintPattern(Mode2.noisePatterns[APP.paletteMix < 0.5 ? 1 : 0], 0.025 + audioGestureEnergy(input) * 0.035);
      context.restore();
    }
  }
  context.restore();
}

function mode2LineWeight() {
  const sizeT = constrain((APP.params.shapeSize - 0.55) / 1.65, 0, 1);
  return lerp(2.6, 14, pow(Mode2.noiseMix, 1.15)) * lerp(0.95, 1.05, sizeT);
}

function resetMode2PushSquare() {
  const size = constrain(min(width, height) * 0.12, 44, 110);
  const make = (kind, x, w, h, mass) => ({ kind, x, y: height * 0.58,
    w, h, mass, vx: 0, vy: 0, angle: 0, angularVelocity: 0,
    lastHit: -1000, hits: 0, voiceIndex: 0 });
  Mode2.bodies = [make("kick", width * 0.35, size, size, 1),
    make("snare", width * 0.65, size * 1.65, size * 0.7, 1.15),
    { ...make("hat", width * 0.5, size, size, 0.7), y: height * 0.3 }];
  Mode2.pushSquare = Mode2.bodies[0];
  Mode2.pushInputs = new WeakMap();
  Mode2.lastCollision = -1000;
  Mode2.collisionCount = 0;
}

function segmentHitsSquare(previous, current, body, padding) {
  let enter = 0, leave = 1;
  const vertices = mode2BodyVertices(body);
  for (const axis of mode2BodyAxes(body)) {
    const projection = vertices.map(p => p.x * axis.x + p.y * axis.y);
    const low = Math.min(...projection) - padding, high = Math.max(...projection) + padding;
    const start = previous.x * axis.x + previous.y * axis.y;
    const delta = (current.x - previous.x) * axis.x + (current.y - previous.y) * axis.y;
    if (Math.abs(delta) < 0.0001) { if (start < low || start > high) return false; }
    else {
      const a = (low - start) / delta, b = (high - start) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return false;
    }
  }
  return true;
}

function playMode2Body(body, strength) {
  const voice = AudioEngine.voices?.[body.voiceIndex] || AudioEngine;
  // X controls the reverb of the impact, Y its pentatonic fundamental.
  if (voice.context) voice.setReverb(lerp(0.02, 1.25, constrain(body.x / width, 0, 1)));
  if (body.kind === "kick") voice.triggerImpactKick(strength, body.y);
  else if (body.kind === "hat") voice.triggerHiHat(strength, body.y, body.x);
  else voice.triggerSnare(strength, body.y);
  body.lastHit = millis(); body.hits++;
}

function updateMode2PushSquare(inputs) {
  if (!Mode2.bodies) return;
  const dt = constrain(deltaTime / 1000, 0.001, 0.04);
  for (const input of inputs) {
    if (!input.inputActive) {
      if (APP.touchInputUsed || mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height || pointIsOverUI(mouseX, mouseY)) Mode2.pushInputs.delete(input);
      continue;
    }
    const current = input.targetInteraction, previous = Mode2.pushInputs.get(input);
    Mode2.pushInputs.set(input, { x: current.x, y: current.y });
    if (!previous) continue;
    const dx = current.x - previous.x, dy = current.y - previous.y, distance = Math.hypot(dx, dy);
    if (distance < 2) continue;
    for (const body of Mode2.bodies) {
      if (millis() - body.lastHit < 170 || !segmentHitsSquare(previous, current, body, 12)) continue;
      const speed = constrain(distance / dt, 70, 1000);
      body.vx = constrain(body.vx + dx / distance * speed * 0.7 / body.mass, -1200, 1200);
      body.vy = constrain(body.vy + dy / distance * speed * 0.7 / body.mass, -1200, 1200);
      const fraction = constrain(((body.x - previous.x) * dx + (body.y - previous.y) * dy) / (distance * distance), 0, 1);
      const leverX = previous.x + dx * fraction - body.x, leverY = previous.y + dy * fraction - body.y;
      const torque = (leverX * dy / distance - leverY * dx / distance) / (Math.max(body.w, body.h) * 0.5);
      body.angularVelocity = constrain(body.angularVelocity + torque * speed * 0.008, -5, 5);
      body.voiceIndex = APP.touchInputUsed ? Math.max(0, APP.touchVoices.indexOf(input)) : 0;
      playMode2Body(body, constrain(speed / 850, 0.2, 1));
    }
  }
  const maxSpeed = Math.max(...Mode2.bodies.map(body => Math.hypot(body.vx, body.vy)));
  const steps = Math.min(8, Math.max(1, Math.ceil(maxSpeed * dt / (Math.min(...Mode2.bodies.map(body => Math.min(body.w, body.h))) * 0.3))));
  for (let step = 0; step < steps; step++) {
    const tick = dt / steps;
    for (const body of Mode2.bodies) {
      body.angle += body.angularVelocity * tick;
      body.angularVelocity *= Math.exp(-tick * 2.2);
      body.vx *= Math.exp(-tick * 2.4); body.vy *= Math.exp(-tick * 2.4);
      body.x += body.vx * tick; body.y += body.vy * tick;
      const cosine = Math.abs(Math.cos(body.angle)), sine = Math.abs(Math.sin(body.angle));
      const marginX = body.w / 2 * cosine + body.h / 2 * sine + 8;
      const marginY = body.w / 2 * sine + body.h / 2 * cosine + 8;
      if (body.x < marginX || body.x > width - marginX) body.vx *= -0.35;
      if (body.y < marginY || body.y > height - marginY) body.vy *= -0.35;
      body.x = constrain(body.x, marginX, width - marginX);
      body.y = constrain(body.y, marginY, height - marginY);
    }
    for (let i = 0; i < Mode2.bodies.length; i++)
      for (let j = i + 1; j < Mode2.bodies.length; j++) resolveMode2BodyCollision(Mode2.bodies[i], Mode2.bodies[j]);
  }
}

function mode2BodyVertices(body) {
  const local = body.kind === "hat" ? [[0, -body.h / 2], [body.w / 2, body.h / 2], [-body.w / 2, body.h / 2]]
    : [[-body.w / 2, -body.h / 2], [body.w / 2, -body.h / 2], [body.w / 2, body.h / 2], [-body.w / 2, body.h / 2]];
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return local.map(([x, y]) => ({ x: body.x + x * c - y * s, y: body.y + x * s + y * c }));
}
function mode2BodyAxes(body) {
  const vertices = mode2BodyVertices(body);
  return vertices.map((p, i) => {
    const q = vertices[(i + 1) % vertices.length], dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
    return { x: -dy / length, y: dx / length };
  });
}
function resolveMode2BodyCollision(a, b) {
  let overlap = Infinity, normal = null;
  const av = mode2BodyVertices(a), bv = mode2BodyVertices(b);
  for (const axis of [...mode2BodyAxes(a), ...mode2BodyAxes(b)]) {
    const ap = av.map(p => p.x * axis.x + p.y * axis.y), bp = bv.map(p => p.x * axis.x + p.y * axis.y);
    const depth = Math.min(Math.max(...ap) - Math.min(...bp), Math.max(...bp) - Math.min(...ap));
    if (depth <= 0) return false;
    if (depth < overlap) {
      overlap = depth;
      const sign = (b.x - a.x) * axis.x + (b.y - a.y) * axis.y < 0 ? -1 : 1;
      normal = { x: axis.x * sign, y: axis.y * sign };
    }
  }
  const invA = 1 / a.mass, invB = 1 / b.mass, inverseMass = invA + invB;
  a.x -= normal.x * (overlap + 0.1) * invA / inverseMass;
  a.y -= normal.y * (overlap + 0.1) * invA / inverseMass;
  b.x += normal.x * (overlap + 0.1) * invB / inverseMass;
  b.y += normal.y * (overlap + 0.1) * invB / inverseMass;
  const closing = (a.vx - b.vx) * normal.x + (a.vy - b.vy) * normal.y;
  if (closing > 0) {
    const impulse = closing * 1.65 / inverseMass;
    a.vx -= impulse * normal.x * invA; a.vy -= impulse * normal.y * invA;
    b.vx += impulse * normal.x * invB; b.vy += impulse * normal.y * invB;
    const tangent = (a.vx - b.vx) * -normal.y + (a.vy - b.vy) * normal.x;
    a.angularVelocity = constrain(a.angularVelocity + tangent * 0.003, -5, 5);
    b.angularVelocity = constrain(b.angularVelocity - tangent * 0.003, -5, 5);
    if (closing > 25 && millis() - Mode2.lastCollision > 180) {
      Mode2.lastCollision = millis(); Mode2.collisionCount++;
      const strength = constrain(closing / 900, 0.15, 0.85);
      playMode2Body(a, strength); playMode2Body(b, strength);
    }
  }
  return true;
}

function drawMode2PushSquare() {
  for (const body of Mode2.bodies || []) {
    push(); rectMode(CENTER);
    const hit = constrain(1 - (millis() - body.lastHit) / 220, 0, 1);
    fill(lerp(35, 240, hit)); stroke(255); strokeWeight(mode2LineWeight() * 0.85);
    translate(body.x, body.y); rotate(body.angle);
    if (body.kind === "hat") triangle(0, -body.h / 2, body.w / 2, body.h / 2, -body.w / 2, body.h / 2);
    else rect(0, 0, body.w, body.h);
    pop();
  }
}
