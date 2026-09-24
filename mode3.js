// Mode 3: projected 3D solids, bounded planar physics and independent FM voices.
window.Mode3 = {
  bodies: [], grain: [], collisionEnergy: 0, collisionPairs: new Map(), light: { x: -0.5, y: -0.55, z: 0.67 },
  init() {
    this.collisionEnergy = 0; this.collisionPairs.clear();
    this.bodies = Array.from({ length: 24 }, (_, i) => ({
      kind: i % 2 ? "sphere" : "cube",
      x: width * (width >= height ? (0.5 + i % 6) / 6 : 0.17 + (i % 3) * 0.33),
      y: height * (width >= height ? 0.125 + Math.floor(i / 6) * 0.25 : (0.5 + Math.floor(i / 3)) / 8),
      vx: 0, vy: 0, ax: 0.35 + i * 0.4, ay: 0.5 + i * 0.7, az: 0,
      spin: 0, seed: i * 15.71, r: 1
    }));
    // Fixed surface samples: grain moves with the solid instead of flickering.
    if (!this.grain.length) {
      let seed = 7351;
      const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 1500; i++) {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        this.grain.push({ x: r * Math.cos(a), y: r * Math.sin(a), z, threshold: rand() });
      }
    }
  },
  enter() {
    syncShapeSizeLimit();
    document.getElementById("panel-title").textContent = "MODE 3 · FM OBJECTS";
    document.getElementById("mode-axis-x").textContent = "X: Tremolo + Reverb";
    for (const input of [APP, ...APP.touchVoices]) { input.fmEnergy = 0; input.fmCollision = 0; }
  },
  exit() { for (const input of [APP, ...APP.touchVoices]) { input.fmEnergy = 0; input.fmCollision = 0; } },
  update() {
    const dt = Math.min(deltaTime / 1000, 0.04);
    const inputs = APP.touchInputUsed ? APP.touchVoices : [APP];
    this.collisionEnergy *= Math.exp(-dt * 3.2);
    for (const input of inputs) input.fmCollision = (input.fmCollision || 0) * Math.exp(-dt * 3.2);

    const lightAngle = -2.3 + APP.params.pitch / 12 * 1.35;
    this.light = { x: Math.cos(lightAngle) * 0.75, y: Math.sin(lightAngle) * 0.75, z: 0.66 };
    const sizeT = constrain((APP.params.shapeSize - 0.55) / 1.65, 0, 1);
    const unit = Math.min(width, height);
    const radius = lerp(unit * 0.07, Math.min(unit * 0.15, Math.sqrt(width * height / (24 * Math.PI)) * 0.78), sizeT);
    for (const input of inputs) input.fmEnergy = (input.fmEnergy || 0) * Math.exp(-dt * 5);
    for (const b of this.bodies) {
      b.r = Math.min(radius, Math.min(width, height) * 0.23);
      for (const input of inputs) {
        if (!input.inputActive) continue;
        const dx = b.x - input.interaction.x, dy = b.y - input.interaction.y;
        const distance = Math.hypot(dx, dy), reach = mode3InfluenceRadius() + b.r;
        if (distance >= reach) continue;
        const falloff = Math.pow(1 - distance / reach, 1.2);
        const force = falloff * (2000 + 4200 * audioGestureEnergy(input));
        const normalLength = Math.hypot(dx, dy) || 1;
        const nx = dx / normalLength, ny = dy / normalLength;
        const speed = Math.hypot(input.previousVelocityX, input.previousVelocityY);
        const carry = Math.min(speed / 24, 1) * force * 0.95;
        b.vx += (nx * force + (speed > 0 ? input.previousVelocityX / speed : 0) * carry) * dt;
        b.vy += (ny * force + (speed > 0 ? input.previousVelocityY / speed : 0) * carry) * dt;
        b.owner = input;
        b.spin += (nx * input.previousVelocityY - ny * input.previousVelocityX) * falloff * dt * 0.08;
        input.fmEnergy = Math.max(input.fmEnergy, falloff * (0.15 + audioGestureEnergy(input)));
      }
      const t = millis() * 0.0013;
      const turbulence = APP.params.audioNoise ** 1.3 * 110;
      b.vx += Math.sin(t * 2.1 + b.seed + noise(b.seed, t) * 5) * turbulence * dt;
      b.vy += Math.cos(t * 1.7 + b.seed + noise(b.seed + 8, t) * 5) * turbulence * dt;
      b.vx = constrain(b.vx, -600, 600) * Math.exp(-dt * 0.65);
      b.vy = constrain(b.vy, -600, 600) * Math.exp(-dt * 0.65);
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ax += b.vy * dt / Math.max(60, b.r) * 0.5;
      b.ay += b.vx * dt / Math.max(60, b.r) * 0.5;
      b.az += b.spin * dt; b.spin *= Math.exp(-dt * 2);
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy), overlap = a.r + b.r - distance;
        if (overlap <= 0) continue;
        const nx = distance > 0.001 ? dx / distance : 1, ny = distance > 0.001 ? dy / distance : 0;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (closing > 45) {
          const key = i + ":" + j, now = millis();
          if (now - (this.collisionPairs.get(key) ?? -1000) > 100) {
            this.collisionPairs.set(key, now);
            const impact = Math.min(0.4, closing / 1000);
            this.collisionEnergy = Math.min(1, this.collisionEnergy + impact);
            for (const input of new Set([a.owner, b.owner])) {
              if (!input || !inputs.includes(input)) continue;
              input.fmCollision = Math.min(1, (input.fmCollision || 0) + impact);
            }
          }
        }
        if (closing > 0) {
          a.vx -= closing * nx * 0.94; a.vy -= closing * ny * 0.94;
          b.vx += closing * nx * 0.94; b.vy += closing * ny * 0.94;
          a.spin += closing * 0.002; b.spin -= closing * 0.002;
        }
      }
      for (const b of this.bodies) {
        const r = b.r + 3;
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.9; }
        if (b.x > width - r) { b.x = width - r; b.vx = -Math.abs(b.vx) * 0.9; }
        if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * 0.9; }
        if (b.y > height - r) { b.y = height - r; b.vy = -Math.abs(b.vy) * 0.9; }
      }
    }
  },
  draw() {
    background(lerp(255, 116, APP.paletteMix), lerp(225, 28, APP.paletteMix), lerp(0, 205, APP.paletteMix));
    const ctx = drawingContext;
    Mode3Background.draw(ctx);
    this.surfaceNoise = Math.min(1, 0.22 + APP.params.audioNoise * 0.78 + this.collisionEnergy * 0.45);
    this.grainPhase = millis() * 0.001 * (1 + this.surfaceNoise * 7);
    // Center gesture inverts the solids and transitions the flat background to purple.
    this.paper = APP.paletteSwapped ? "black" : "white";
    this.ink = APP.paletteSwapped ? "white" : "black";
    for (const b of this.bodies) {
      b.rotation = [Math.cos(b.ax), Math.sin(b.ax), Math.cos(b.ay), Math.sin(b.ay), Math.cos(b.az), Math.sin(b.az)];
      ctx.save(); ctx.translate(b.x, b.y);
      ctx.lineWidth = 2.5; ctx.strokeStyle = this.ink;
      if (b.kind === "sphere") drawMode3Sphere(ctx, b);
      else drawMode3Cube(ctx, b);
      ctx.restore();
    }
  }
};

function rotateMode3Point(p, b) {
  const [cx,sx,cy,sy,cz,sz] = b.rotation;
  const y = p.y * cx - p.z * sx, z = p.y * sx + p.z * cx;
  const x = p.x * cy + z * sy, depth = -p.x * sy + z * cy;
  return { x: x * cz - y * sz, y: x * sz + y * cz, z: depth };
}
function drawMode3Sphere(ctx, b) {
  ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fillStyle = Mode3.paper; ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = Mode3.ink;
  ctx.beginPath();
  // Batch the grain into one path per solid instead of thousands of draw calls.
  for (const p of Mode3.grain) {
    const q = rotateMode3Point(p, b);
    if (q.z < 0) continue;
    const light = q.x * Mode3.light.x + q.y * Mode3.light.y + q.z * Mode3.light.z;
    const shade = constrain((0.65 - light) * 1.8, 0, 1);
    if (mode3GrainThreshold(p, b) > shade) continue;
    const dot = Math.max(1, b.r * (0.052 + Mode3.surfaceNoise * 0.03));
    ctx.rect(q.x * b.r - dot / 2, q.y * b.r - dot / 2, dot, dot);
  }
  ctx.fill(); ctx.restore();
  ctx.beginPath();ctx.arc(0,0,b.r,0,Math.PI*2);ctx.stroke();
}
function drawMode3Cube(ctx, b) {
  const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const points = vertices.map(([x,y,z]) => rotateMode3Point({x:x / Math.sqrt(3),y:y / Math.sqrt(3),z:z / Math.sqrt(3)}, b));
  const faces = [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]];
  faces.sort((a,c) => a.reduce((s,i)=>s+points[i].z,0)-c.reduce((s,i)=>s+points[i].z,0));
  for (const face of faces) {
    const a=points[face[0]], c=points[face[1]], d=points[face[2]];
    const ux=c.x-a.x, uy=c.y-a.y, uz=c.z-a.z, vx=d.x-a.x, vy=d.y-a.y, vz=d.z-a.z;
    const normal={x:uy*vz-uz*vy,y:uz*vx-ux*vz,z:ux*vy-uy*vx};
    if(normal.z <= 0) continue;
    const length=Math.hypot(normal.x,normal.y,normal.z);
    const light=(normal.x*Mode3.light.x+normal.y*Mode3.light.y+normal.z*Mode3.light.z)/length;
    ctx.beginPath();face.forEach((index,i)=>{const p=points[index];if(i)ctx.lineTo(p.x*b.r,p.y*b.r);else ctx.moveTo(p.x*b.r,p.y*b.r);});ctx.closePath();
    ctx.fillStyle=light>0.15?Mode3.paper:Mode3.ink;ctx.fill();
    ctx.save();ctx.clip();ctx.fillStyle=light>0.15?Mode3.ink:Mode3.paper;
    ctx.beginPath();
    // Batch stipple and cull hidden faces.
    for(let i=0;i<500;i++) {
      const p=Mode3.grain[i];
      if(mode3GrainThreshold(p,b)>0.4 + Mode3.surfaceNoise * 0.3)continue;
      const dot = 1.5 + Mode3.surfaceNoise * 2;
      ctx.rect(p.x*b.r,p.y*b.r,dot,dot);
    }
    ctx.fill();ctx.restore();
    ctx.beginPath();face.forEach((index,i)=>{const p=points[index];if(i)ctx.lineTo(p.x*b.r,p.y*b.r);else ctx.moveTo(p.x*b.r,p.y*b.r);});ctx.closePath();ctx.stroke();
  }
}

function mode3InfluenceRadius() { return APP.params.influenceRadius * 0.4; }
function mode3GrainThreshold(p, b) {
  const movement = Math.sin(Mode3.grainPhase + p.x * 23 + p.y * 17 + b.seed) * Mode3.surfaceNoise * 0.42;
  return constrain(p.threshold + movement, 0, 1);
}
