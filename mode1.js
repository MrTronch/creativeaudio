// MODE 1: monochrome eyes over a chromatic heat grid.
const MODE1_BACKGROUND_A = [196, 35, 45];
const MODE1_FOREGROUND_A = [34, 82, 190];
const CENTER_SWAP_DURATION = 1000;
const CENTER_SWAP_COOLDOWN = 2000;
const CENTER_TRIGGER_RADIUS = 72;
const CENTER_FEEDBACK_DURATION = 420;
const COLOR_Y_SMOOTHING = 0.018;
window.Mode1 = {
  points: [],
  colorY: 0.5,
  signature: "",
  heatStamp: null,
  heldFuchsia: [], focusClosure: 0, fuchsiaHeld: false, nextBlinkAt: 0, greenEye: null, nextGreenAt: 0, blurStart: -1000,
  nextSpecialAt: 0, specialEyes: [], specialUntil: 0, specialContacts: new Set(),
  init: initMode1,
  enter: enterMode1,
  update: updateMode1,
  draw: drawMode1,
  exit: exitMode1,
  CENTER_SWAP_DURATION,
  CENTER_SWAP_COOLDOWN,
  CENTER_TRIGGER_RADIUS,
  CENTER_FEEDBACK_DURATION,
  resize() { this.signature = ""; }
};

function initMode1() {
  Mode1.heatStamp = createMode1HeatStamp();
  initMode1Chromatic();
  rebuildMode1Points();
}

function enterMode1() {
  syncShapeSizeLimit();
  Mode1.signature = "";
  document.getElementById("panel-title").textContent = "MODE 1 · EYES";
  document.getElementById("mode-axis-x").textContent = "X: Reverb";
}

function exitMode1() { Mode1.focusClosure=0;Mode1.fuchsiaHeld=false; Mode1.blurStart = -1000; const canvas=document.querySelector("#canvas-container canvas"); if(canvas)canvas.style.filter=""; }

function updateMode1() {
  ensureMode1Points();
  const colorTarget = constrain(APP.interaction.y / max(height, 1), 0, 1);
  const colorFollow = 1 - pow(1 - COLOR_Y_SMOOTHING, deltaTime / 16.667);
  Mode1.colorY = lerp(Mode1.colorY, colorTarget, colorFollow);

  const trailT = constrain((APP.params.trailPersistence - 1) / 9, 0, 1);
  const highlightInputs = APP.touchInputUsed
    ? APP.touchVoices.filter(voice => voice.active)
    : APP.hasInteracted && mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height && !pointIsOverUI(mouseX, mouseY)
      ? [{ x: mouseX, y: mouseY }] : [];
  const paintInputs = APP.touchInputUsed
    ? APP.touchVoices.filter(voice => voice.active)
    : APP.inputActive ? [APP] : [];
  const heatDecay = Math.exp(-Math.min(deltaTime, 100) / lerp(450, 1900, trailT));
  const paintRadius = APP.params.influenceRadius * 0.6;

  const now = millis();
  updateMode1SpecialEye(now, highlightInputs);
  const followLid = 1 - Math.exp(-Math.min(deltaTime, 50) / (Mode1.fuchsiaHeld ? 95 : 145));
  Mode1.focusClosure = lerp(Mode1.focusClosure, Mode1.fuchsiaHeld ? 1 : 0, followLid);
  if (now >= Mode1.nextBlinkAt && Mode1.points.length) {
    const chosen = Mode1.points[floor(random(Mode1.points.length))];
    chosen.blinkStart = now;
    Mode1.nextBlinkAt = now + random(1700, 3600);
  }
  for (const point of Mode1.points) {
    const naturalOpen = 1 - mode1BlinkClosure(now - point.blinkStart);
    const fuchsia = Mode1.specialEyes.includes(point);
    const near = !fuchsia && Mode1.heldFuchsia.some(eye => Math.hypot(point.x-eye.x, point.y-eye.y) <= point.cellSize*1.5);
    point.neighborClosure = lerp(point.neighborClosure || 0, near ? 1 : 0, 1-Math.exp(-Math.min(deltaTime,50)/(near?95:145)));
    point.blinkOpen = fuchsia ? lerp(naturalOpen, 1, Mode1.focusClosure) : naturalOpen * (1 - point.neighborClosure);
    let nearest = APP.interaction;
    let nearestDistance = Infinity;
    for (const input of paintInputs) {
      const distance = dist(point.x, point.y, input.interaction.x, input.interaction.y);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = input.interaction; }
    }

    const lookX = constrain((nearest.x - point.x) / (APP.params.influenceRadius * 0.45), -1, 1);
    const lookY = constrain((nearest.y - point.y) / (APP.params.influenceRadius * 0.45), -1, 1);
    point.lookX = lerp(point.lookX, lookX, 0.24);
    point.lookY = lerp(point.lookY, lookY, 0.24);
    point.highlighted = highlightInputs.some(input =>
      input.x >= point.x - point.cellSize / 2 && input.x < point.x + point.cellSize / 2 &&
      input.y >= point.y - point.cellSize / 2 && input.y < point.y + point.cellSize / 2);
    point.heat *= heatDecay;
    for (const input of paintInputs) {
      const paintDistance = dist(point.x, point.y, input.interaction.x, input.interaction.y);
      const paint = constrain(1 - paintDistance / paintRadius, 0, 1);
      point.heat = Math.max(point.heat, paint * paint);
    }
  }
}

function drawMode1() {
  const elapsed=millis()-Mode1.blurStart;
  const blur=elapsed>=0 && elapsed<1100 ? 7*Math.sin(Math.PI*elapsed/1100)**2 : 0;
  const canvas=document.querySelector("#canvas-container canvas");
  const chroma=Mode1.focusClosure*1.6;
  if(Mode1.chromaRed) { Mode1.chromaRed.setAttribute("dx",chroma.toFixed(2)); Mode1.chromaBlue.setAttribute("dx",(-chroma).toFixed(2)); }
  if(canvas)canvas.style.filter=(blur>0.01?`blur(${blur.toFixed(2)}px) `:"")+(chroma>0.03?"url(#mode1-chromatic)":"");
  resetMatrix();
  blendMode(BLEND);
  noTint();
  strokeWeight(1);

  const backgroundA = mode1PaletteColor(Mode1.colorY, true);
  const foregroundA = mode1PaletteColor(Mode1.colorY, false);
  const backgroundB = foregroundA;
  const foregroundB = backgroundA;
  background(lerpColor(backgroundA, backgroundB, APP.paletteMix));
  drawMode1HeatMap();
  noStroke();
  fill(lerpColor(foregroundA, foregroundB, APP.paletteMix));

  for (const point of Mode1.points) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.size) ||
      point.size <= 0
    ) {
      console.error("MODE 1 INVALID POINT:", point);
      continue;
    }

    drawMode1Eye(point, point.size);
  }
}
function rebuildMode1Points() {
  Mode1.points.length = 0;
  // At maximum size: exactly 6 x 3 eyes on landscape, 3 x 6 on portrait.
  const sizeT = constrain((APP.params.shapeSize - 0.55) / (1.7875 - 0.55), 0, 1);
  const densityT = pow(sizeT, 0.45);
  const longCount = round(lerp(12, 6, densityT)), shortCount = round(lerp(6, 3, densityT));
  const columns = width >= height ? longCount : shortCount;
  const rows = width >= height ? shortCount : longCount;
  const cellSize = min(width / columns, height / rows);
  const offsetX = (width - columns * cellSize) / 2;
  const offsetY = (height - rows * cellSize) / 2;
  const size = cellSize * 0.94;
  Mode1.cellSize = cellSize;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = offsetX + (col + 0.5) * cellSize;
      const y = offsetY + (row + 0.5) * cellSize;
      Mode1.points.push({ x, y, cellSize, size, heat: 0, lookX: 0, lookY: 0, highlighted: false, blinkStart: -1000, blinkOpen: 1 });
    }
  }

  Mode1.specialEyes = []; Mode1.specialContacts.clear();
  Mode1.focusClosure=0;Mode1.fuchsiaHeld=false;
  Mode1.greenEye=null;Mode1.nextGreenAt=millis()+random(3000,4800);
  Mode1.nextSpecialAt = millis() + random(3000, 5000);
  Mode1.nextBlinkAt = millis() + random(1700, 3600);
  Mode1.signature = mode1Signature();
}
function mode1PaletteColor(value, backgroundLayer) {
  const stops = backgroundLayer
    ? [[112, 36, 184], [228, 96, 28], MODE1_BACKGROUND_A, [15, 139, 130], [32, 62, 181]]
    : [[245, 169, 42], [37, 63, 169], MODE1_FOREGROUND_A, [232, 77, 117], [240, 151, 46]];
  const position = constrain(value, 0, 1) * (stops.length - 1);
  const index = min(floor(position), stops.length - 2);
  return lerpColor(color(...stops[index]), color(...stops[index + 1]), position - index);
}

function ensureMode1Points() {
  if (Mode1.signature !== mode1Signature()) rebuildMode1Points();
}

function mode1Signature() {
  return [width, height, APP.params.shapeSize].join(":");
}

// Cache one smooth stamp; no full-frame pixel processing or growing trail buffers.
function createMode1HeatStamp() {
  const stamp = document.createElement("canvas");
  stamp.width = stamp.height = 256;
  const context = stamp.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(45, 232, 90, 0.98)");
  gradient.addColorStop(0.42, "rgba(65, 224, 70, 0.92)");
  gradient.addColorStop(0.7, "rgba(247, 220, 45, 0.72)");
  gradient.addColorStop(0.82, "rgba(250, 187, 35, 0.38)");
  gradient.addColorStop(1, "rgba(250, 187, 35, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return stamp;
}

function drawMode1HeatMap() {
  const radius = Mode1.cellSize * 0.85;
  const context = drawingContext;
  context.save();
  for (const point of Mode1.points) {
    if (point.heat < 0.008) continue;
    context.globalAlpha = Math.sqrt(point.heat);
    context.drawImage(Mode1.heatStamp, point.x - radius, point.y - radius, radius * 2, radius * 2);
  }
  context.restore();
}

function drawMode1Eye(point, size) {
  const context = drawingContext;
  const half = size * 0.5;
  const arch = size * 0.36;
  context.save();
  context.translate(point.x, point.y);
  const closure = 1 - point.blinkOpen;
  const upperArch = lerp(-arch, arch, closure);
  // Only the upper lid descends; the iris and lower lid retain their geometry.
  context.beginPath();
  context.moveTo(-half, 0);
  context.bezierCurveTo(-size * 0.22, upperArch, size * 0.22, upperArch, half, 0);
  context.bezierCurveTo(size * 0.22, arch, -size * 0.22, arch, -half, 0);
  context.closePath();
  context.fillStyle = point === Mode1.greenEye ? "#39ff14" : Mode1.specialEyes.includes(point) && millis() < point.specialUntil ? "#ff008e" : point.highlighted ? "#ffdc35" : "#ffffff";
  context.fill();
  context.strokeStyle = "#080b0c";
  context.lineWidth = size * 0.045;
  context.lineJoin = "round";
  context.stroke();
  context.clip();
  const pupilX = point.lookX * size * 0.24;
  const pupilY = point.lookY * size * 0.11;
  const gaze = Math.min(1, Math.hypot(point.lookX, point.lookY));
  const angle = Math.atan2(point.lookY, point.lookX);
  // Foreshorten the iris as it turns away; the lid clips it naturally at the edges.
  context.translate(pupilX, pupilY);
  context.rotate(angle);
  context.scale(1 - gaze * 0.32, 1);
  context.beginPath();
  context.arc(0, 0, size * 0.235, 0, Math.PI * 2);
  context.lineWidth = size * 0.035;
  context.stroke();
  context.fillStyle = "#080b0c";
  context.beginPath();
  context.arc(0, 0, size * 0.125, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(-size * 0.037, -size * 0.045, size * 0.027, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function mode1BlinkClosure(elapsed) {
  if (elapsed < 0 || elapsed >= 750) return 0;
  if (elapsed < 270) return smoothStep01(elapsed / 270);
  if (elapsed < 350) return 1;
  return 1 - smoothStep01((elapsed - 350) / 400);
}

function updateMode1SpecialEye(now, inputs) {
  Mode1.specialEyes = Mode1.specialEyes.filter(eye => now < eye.specialUntil);
  if(Mode1.greenEye && now>=Mode1.greenEye.specialUntil)Mode1.greenEye=null;
  if(now>=Mode1.nextGreenAt){
    const candidates=Mode1.points.filter(p=>!Mode1.specialEyes.includes(p)&&!pointIsOverUI(p.x,p.y));
    if(candidates.length){Mode1.greenEye=candidates[floor(random(candidates.length))];Mode1.greenEye.specialUntil=now+3200;}
    Mode1.nextGreenAt=now+random(3000,4800);
  }
  if (now >= Mode1.nextSpecialAt && Mode1.points.length) {
    const candidates = Mode1.points.filter(point => point !== Mode1.greenEye && !Mode1.specialEyes.includes(point) && !pointIsOverUI(point.x, point.y));
    const otherRows = candidates.filter(point => !Mode1.specialEyes.some(eye => eye.y === point.y));
    const pool = otherRows.length ? otherRows : candidates;
    if (pool.length && Mode1.specialEyes.length < 3) {
      const eye = pool[floor(random(pool.length))];
      eye.specialUntil = now + random(2700, 3500);
      Mode1.specialEyes.push(eye);
    }
    Mode1.nextSpecialAt = now + random(1050, 1450);
  }
  const touching = new Set();
  Mode1.fuchsiaHeld = false;
  Mode1.heldFuchsia.length=0;
  for (const eye of [...Mode1.specialEyes, ...(Mode1.greenEye ? [Mode1.greenEye] : [])]) {
  for (const input of inputs) {
    const key = `${APP.touchInputUsed ? input.identifier : "mouse"}:${Mode1.points.indexOf(eye)}`;
    if (Math.abs(input.x - eye.x) >= eye.cellSize / 2 || Math.abs(input.y - eye.y) >= eye.cellSize / 2) continue;
    touching.add(key);
    if(Mode1.specialEyes.includes(eye)){Mode1.fuchsiaHeld = true;if(!Mode1.heldFuchsia.includes(eye))Mode1.heldFuchsia.push(eye);}
    if (!Mode1.specialContacts.has(key)) {
      const state = APP.touchInputUsed ? input : APP;
      const voice = audioVoiceForInput(state);
      const green=eye===Mode1.greenEye;
      if(green)Mode1.blurStart=now;
      if (voice.triggerEyeDelay(state, { x: input.x, y: input.y }, green)) eye.delayFlash = now;
    }
  }
  }
  Mode1.specialContacts = touching;
}


function initMode1Chromatic() {
  if(document.getElementById("mode1-chromatic"))return;
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("width","0");svg.setAttribute("height","0");svg.setAttribute("aria-hidden","true");svg.style.position="absolute";
  svg.innerHTML=`<defs><filter id="mode1-chromatic" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>
    <feOffset in="red" dx="0" result="redShift" id="mode1-red-shift"/>
    <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"/>
    <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"/>
    <feOffset in="blue" dx="0" result="blueShift" id="mode1-blue-shift"/>
    <feBlend in="redShift" in2="green" mode="screen" result="rg"/><feBlend in="rg" in2="blueShift" mode="screen"/>
  </filter></defs>`;
  document.body.appendChild(svg);Mode1.chromaRed=document.getElementById("mode1-red-shift");Mode1.chromaBlue=document.getElementById("mode1-blue-shift");
}
