// Shared Web Audio engine. Nodes are created once after START AUDIO.
const HIGH_PITCH_GAIN_REDUCTION = 0.35;
const MODE1_IDLE_TIMEOUT = 1000;
const MODE1_FADE_OUT_TIME = 0.75;
const MODE1_MASTER_GAIN = 0.7;
const MODE2_LOWEST_MIDI = 33;
const MODE2_HIGHEST_MIDI = 81;
const MODE2_TRIGGER_RATE_MIN = 0.6;
const MODE2_TRIGGER_RATE_MAX = 24;
const GLIDE_MIN_SECONDS = 0.02;
const GLIDE_MAX_SECONDS = 0.78;

window.AudioEngine = {
  context: null,
  enabled: false,
  startedOnce: false,
  initializing: false,
  graphReady: false,
  startError: "",
  continuousOscillator: null,
  kickOscillator: null,
  noiseSource: null,
  continuousGain: null,
  kickGain: null,
  noiseBurstGain: null,
  noiseMotionGain: null,
  noiseFilter: null,
  toneFilter: null,
  dryGain: null,
  wetGain: null,
  convolver: null,
  outputGain: null,
  currentMidi: 45,
  previousMidi: 45,
  currentNoteIndex: 0,
  lastKickTime: -1000,
  activeMode: 1,
  mode2GlideHz: midiHz(MODE2_LOWEST_MIDI),
  lastUpdateTime: 0,

  scales: {
    mode1: buildAudioScale(45, 5), // A2-A7
    mode2: buildAudioScaleRange(MODE2_LOWEST_MIDI, MODE2_HIGHEST_MIDI)
  },

  create(context = null) {
    if (this.graphReady) return;
    const c = this.context = context || this.context;
    try {

    this.continuousOscillator = c.createOscillator();
    this.kickOscillator = c.createOscillator();
    this.noiseSource = createPinkNoise(c);
    this.continuousGain = c.createGain();
    this.kickGain = c.createGain();
    this.noiseBurstGain = c.createGain();
    this.noiseMotionGain = c.createGain();
    this.noiseFilter = c.createBiquadFilter();
    this.toneFilter = c.createBiquadFilter();
    this.dryGain = c.createGain();
    this.wetGain = c.createGain();
    this.convolver = c.createConvolver();
    this.outputGain = c.createGain();
    this.snareGain = c.createGain();
    this.snareGain.gain.value = 0;
    this.impactGain = c.createGain(); this.impactGain.gain.value = 0;
    this.effectGain = c.createGain(); this.effectGain.gain.value = 1;
    this.cleanTone = c.createGain();
    this.roughTone = c.createGain(); this.roughTone.gain.value = 0;
    this.shaper = c.createWaveShaper();
    this.shaper.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 1023 * 2 - 1) * 10) / 3);
    this.shaper.oversample = "2x";
    this.mixBus = c.createGain();
    this.arpStep = 0; this.nextArpTime = 0; this.arpActive = false;
    this.eyeEffects = new Set(); this.lastEyeDelay = null;
    if (this === AudioEngine) {
      this.masterCompressor = c.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -5;
      this.masterCompressor.knee.value = 8;
      this.masterCompressor.ratio.value = 8;
      this.masterCompressor.attack.value = 0.003;
      this.masterCompressor.release.value = 0.12;
      this.masterCompressor.connect(c.destination);
    }

    this.continuousOscillator.type = "triangle";
    this.kickOscillator.type = "sine";
    this.continuousGain.gain.value = 0;
    this.kickGain.gain.value = 0;
    this.noiseBurstGain.gain.value = 0;
    this.noiseMotionGain.gain.value = 0;
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 720;
    this.noiseFilter.Q.value = 0.9;
    this.toneFilter.type = "lowpass";
    this.toneFilter.frequency.value = 3100;
    this.toneFilter.Q.value = 1;
    this.outputGain.gain.value = 1.1;
    this.convolver.buffer = createAudioImpulse(c, 2.8);

    this.continuousOscillator.connect(this.continuousGain);
    this.kickOscillator.connect(this.kickGain);
    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseBurstGain);
    this.noiseFilter.connect(this.noiseMotionGain);
    this.continuousGain.connect(this.toneFilter);
    this.kickGain.connect(this.toneFilter);
    this.noiseBurstGain.connect(this.toneFilter);
    this.noiseMotionGain.connect(this.toneFilter);
    this.toneFilter.connect(this.cleanTone);
    this.toneFilter.connect(this.shaper);
    this.shaper.connect(this.roughTone);
    this.cleanTone.connect(this.mixBus); this.roughTone.connect(this.mixBus);
    this.mixBus.connect(this.dryGain); this.mixBus.connect(this.convolver);
    this.impactGain.connect(this.cleanTone); this.impactGain.connect(this.shaper);
    this.effectGain.connect(this.mixBus);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);
    this.outputGain.connect(this.masterCompressor);
    this.snareGain.connect(this.cleanTone);
    this.snareGain.connect(this.shaper);

    this.continuousOscillator.start();
    this.kickOscillator.start();
    this.noiseSource.start();
    this.setReverb(0);
    this.graphReady = true;
    } catch (error) {
      // Dispose only this voice's nodes, never the shared context or compressor.
      for (const node of Object.values(this)) {
        if (!node || typeof node.disconnect !== "function") continue;
        try { if (typeof node.stop === "function") node.stop(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      this.graphReady = false;
      throw error;
    }
  },

  async toggle() {
    if (this.initializing) return;
    if (this.enabled && this.context?.state === "running") {
      this.enabled = false;
      this.silence();
      updateAudioButton();
      return;
    }
    this.initializing = true;
    this.startError = "";
    updateAudioButton();
    let timeout, unlock;
    try {
      // Optional iOS support: intentional playback can bypass the silent switch.
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error("Web Audio unavailable");
        this.context = new Context();
        this.context.addEventListener("statechange", () => updateAudioButton());
      }
      const c = this.context;
      // Invoke resume and start synchronously in the button's user gesture.
      // This project uses native Web Audio, not p5.sound/userStartAudio.
      const resumed = c.state === "running" ? Promise.resolve() : c.resume();
      const ready = Promise.race([
        resumed,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Audio start timeout")), 5000); })
      ]);
      // Attach a rejection handler even if synchronous graph construction fails.
      ready.catch(() => {});
      unlock = c.createBufferSource();
      unlock.buffer = c.createBuffer(1, 1, c.sampleRate);
      unlock.connect(c.destination);
      unlock.start(0);
      this.create();
      if (!this.voices) this.voices = [this, createAudioVoice(c)];
      await ready;
      if (c.state !== "running") throw new Error("Audio context blocked: " + c.state);
      this.enabled = true;
      this.startedOnce = true;
    } catch (error) {
      this.enabled = false;
      if (this.graphReady) this.silence();
      this.startError = "No se pudo activar el sonido. Pulsa para reintentar.";
      console.warn("Audio activation failed:", error);
    } finally {
      clearTimeout(timeout);
      if (unlock) {
        try { unlock.stop(); unlock.disconnect(); } catch (_) {}
      }
      this.initializing = false;
      updateAudioButton();
    }
  },

  update(app) {
    if (!this.graphReady || !this.voices || this.initializing) return;
    const inputs = app.touchInputUsed ? app.touchVoices : [app];
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      const input = inputs[i];
      voice.enabled = this.enabled;
      if (input) {
        input.mode = app.mode;
        input.params = app.params;
        voice.updateVoice(input);
      } else {
        voice.wasRecent = false;
        voice.silenceVoice();
      }
    }
    document.getElementById("note-readout").textContent = this.voices
      .filter((voice, i) => inputs[i] && (!app.touchInputUsed || inputs[i].active))
      .map(voice => midiLabel(voice.currentMidi)).join(" / ") || "?";
  },

  updateVoice(app) {
    if (!this.context) return;
    if (this.activeMode !== app.mode) this.setVoiceMode(app.mode);
    const now = this.context.currentTime;
    const idleTimeout = MODE1_IDLE_TIMEOUT;
    const recent = app.hasInteracted && (app.inputActive || millis() - app.lastInputTime < idleTimeout);
    if (recent && !this.wasRecent) this.lastKickTime = -1000;
    this.wasRecent = recent;
    this.effectGain.gain.setTargetAtTime(this.enabled && app.mode === 1 ? 1 : 0, now, 0.02);
    const y = constrain(1 - app.interaction.y / max(height, 1), 0, 1);
    const notes = app.mode === 1 ? this.scales.mode1 : this.scales.mode2;
    this.previousMidi = this.currentMidi;
    this.currentNoteIndex = round(y * (notes.length - 1));
    const spin = recent ? constrain(app.spinEnergy || 0, 0, 1) : 0;
    this.roughness = spin;
    this.cleanTone.gain.setTargetAtTime(1 - spin * 0.55, now, 0.04);
    this.roughTone.gain.setTargetAtTime(spin * 0.6, now, 0.04);
    const wantsArp = recent && spin > (this.arpActive ? 0.42 : 0.62);
    this.arpJustStepped = false;
    if (wantsArp) {
      if (!this.arpActive) { this.arpStep = 0; this.nextArpTime = now; }
      if (now >= this.nextArpTime) {
        this.arpStep = (this.arpStep + 1) % 4;
        this.nextArpTime = now + lerp(0.22, 0.075, spin);
        this.arpJustStepped = true;
      }
      const root = Math.min(this.currentNoteIndex, notes.length - 6);
      this.currentNoteIndex = Math.max(0, root) + [0, 2, 4, 5][this.arpStep];
    }
    this.arpActive = wantsArp;
    this.currentMidi = notes[this.currentNoteIndex] + app.params.pitch;

    if (app.mode === 2 && recent && this.currentMidi !== this.previousMidi) this.triggerNoiseBurst();

    const energy = audioGestureEnergy(app);
    const x = constrain(app.interaction.x / max(width, 1), 0, 1);
    const modulationRate = lerp(0.25, 9, pow(x, 1.2));
    const modulation = 0.55 + 0.45 * (sin(millis() * 0.001 * TWO_PI * modulationRate) * 0.5 + 0.5);
    const normalizedPitch = this.currentNoteIndex / max(notes.length - 1, 1);
    const pitchCompensation = 1 - HIGH_PITCH_GAIN_REDUCTION * pow(normalizedPitch, 1.65);
    const continuousTarget = this.enabled && this.activeMode === 1 && recent
      ? lerp(0.003, 0.13, pow(energy, 1.4)) * MODE1_MASTER_GAIN * modulation * pitchCompensation : 0;
    const noiseTarget = this.enabled && recent
      ? app.params.audioNoise * (app.mode === 1 ? lerp(0.12, 1, energy) * 0.085 : energy * 0.05) : 0;

    const trailT = constrain((app.params.trailPersistence - 1) / 9, 0, 1);
    const mode1Glide = lerp(GLIDE_MIN_SECONDS, GLIDE_MAX_SECONDS, pow(trailT, 1.25));
    const mode2Glide = lerp(0.008, 0.08, pow(trailT, 1.2));
    const targetHz = midiHz(this.currentMidi);
    this.continuousOscillator.frequency.cancelScheduledValues(now);
    this.continuousOscillator.frequency.setTargetAtTime(max(targetHz, 1), now, this.arpActive ? 0.012 : mode1Glide / 3);

    const elapsed = this.lastUpdateTime ? max(now - this.lastUpdateTime, 0.001) : 0.016;
    this.lastUpdateTime = now;
    const mode2Follow = 1 - exp(-elapsed / max(mode2Glide, 0.001));
    this.mode2GlideHz = lerp(this.mode2GlideHz, targetHz, mode2Follow);
    this.attackSeconds = lerp(0.16, 0.008, constrain(app.params.motionReactivity / 2, 0, 1));
    if (app.mode === 1 && this.arpJustStepped) {
      this.continuousGain.gain.cancelScheduledValues(now);
      this.continuousGain.gain.setValueAtTime(Math.min(this.continuousGain.gain.value, continuousTarget * 0.35), now);
    }
    this.continuousGain.gain.setTargetAtTime(continuousTarget, now, continuousTarget > this.continuousGain.gain.value ? this.attackSeconds : 0.24);
    this.noiseMotionGain.gain.setTargetAtTime(noiseTarget, now, app.mode === 1 ? (noiseTarget > this.noiseMotionGain.gain.value ? 0.28 : 0.45) : (noiseTarget > this.noiseMotionGain.gain.value ? 0.05 : 0.32));
    this.setReverb(lerp(0.02, 1.25, pow(x, 1.2)));

    if (this.activeMode === 2 && recent) {
      const rate = lerp(MODE2_TRIGGER_RATE_MIN, MODE2_TRIGGER_RATE_MAX, pow(x, 2.15));
      if (this.arpActive ? this.arpJustStepped : millis() - this.lastKickTime >= 1000 / rate) this.triggerKick(app);
    }

    if (!recent) {
      this.continuousGain.gain.setTargetAtTime(0, now, app.mode === 1 ? MODE1_FADE_OUT_TIME / 3 : 0.3);
      this.kickGain.gain.setTargetAtTime(0, now, 0.2);
      this.noiseMotionGain.gain.setTargetAtTime(0, now, app.mode === 1 ? MODE1_FADE_OUT_TIME / 3 : 0.35);
      this.noiseBurstGain.gain.setTargetAtTime(0, now, app.mode === 1 ? MODE1_FADE_OUT_TIME / 3 : 0.35);
    }
  },

  triggerNoiseBurst() {
    if (!this.context || !this.enabled || this.activeMode !== 2 || APP.mode !== 2 || APP.params.audioNoise <= 0) return;
    const now = this.context.currentTime;
    const peak = 0.0001 + APP.params.audioNoise * 0.17;
    this.noiseBurstGain.gain.cancelScheduledValues(now);
    this.noiseBurstGain.gain.setValueAtTime(0.0001, now);
    this.noiseBurstGain.gain.exponentialRampToValueAtTime(peak, now + 0.007);
    this.noiseBurstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    this.noiseBurstGain.gain.setTargetAtTime(0, now + 0.48, 0.02);
  },

  triggerKick(app) {
    if (this.activeMode !== 2 || app.mode !== 2) return;
    this.lastKickTime = millis();
    if (!this.context || !this.enabled) return;

    const now = this.context.currentTime;
    const base = max(this.mode2GlideHz, 20);
    const decay = lerp(0.46, 0.1, app.gestureSpeed);
    const peak = lerp(0.012, 0.17, pow(audioGestureEnergy(app), 1.35));

    this.kickOscillator.frequency.cancelScheduledValues(now);
    this.kickOscillator.frequency.setValueAtTime(base * 2.1, now);
    this.kickOscillator.frequency.exponentialRampToValueAtTime(base, now + 0.065);
    this.kickGain.gain.cancelScheduledValues(now);
    this.kickGain.gain.setValueAtTime(0.0001, now);
    this.kickGain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    this.kickGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    this.kickGain.gain.setTargetAtTime(0, now + decay, 0.02);
  },

  triggerImpactKick(strength, positionY = height / 2) {
    if (!this.context || !this.enabled || this.context.state !== "running" || APP.mode !== 2) return;
    const c = this.context, now = c.currentTime;
    const notes = buildAudioScaleRange(33, 57);
    const note = notes[Math.round(constrain(1 - positionY / max(height, 1), 0, 1) * (notes.length - 1))];
    this.lastImpactMidi = note;
    const oscillator = c.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(midiHz(note) * 2.6, now);
    oscillator.frequency.exponentialRampToValueAtTime(midiHz(note), now + 0.055);
    const gain = this.impactGain.gain;
    gain.cancelScheduledValues(now); gain.setValueAtTime(0.0001, now);
    gain.exponentialRampToValueAtTime(0.2 + strength * 0.34, now + 0.004);
    gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    gain.setTargetAtTime(0, now + 0.38, 0.02);
    oscillator.connect(this.impactGain); oscillator.start(now); oscillator.stop(now + 0.43);
    oscillator.onended = () => oscillator.disconnect();
  },

  triggerEyeDelay(input, position) {
    if (!this.context || !this.enabled || this.context.state !== "running" || APP.mode !== 1) return false;
    const c = this.context, now = c.currentTime;
    if (this.lastEyeDelay && now - this.lastEyeDelay.at < 0.18) return false;
    while (this.eyeEffects.size >= 4) this.eyeEffects.values().next().value();
    const x = constrain(position.x / max(width, 1), 0, 1);
    const y = constrain(1 - position.y / max(height, 1), 0, 1);
    const note = this.scales.mode1[Math.round(y * (this.scales.mode1.length - 1))] + APP.params.pitch;
    const delayTime = lerp(0.12, 0.48, x), feedbackAmount = lerp(0.22, 0.58, x);
    const oscillator = c.createOscillator(), envelope = c.createGain();
    const delay = c.createDelay(1), feedback = c.createGain(), echoes = c.createGain();
    oscillator.type = "triangle"; oscillator.frequency.value = midiHz(note);
    envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(0.065, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.16); envelope.gain.setValueAtTime(0, now + 0.18);
    delay.delayTime.value = delayTime; feedback.gain.value = feedbackAmount; echoes.gain.value = 0.85;
    oscillator.connect(envelope); envelope.connect(this.effectGain); envelope.connect(delay);
    delay.connect(feedback); feedback.connect(delay); delay.connect(echoes); echoes.connect(this.effectGain);
    this.lastEyeDelay = { note, delayTime, feedback: feedbackAmount, at: now };
    oscillator.start(now); oscillator.stop(now + delayTime * 12 + 0.3);
    const cleanup = () => {
      oscillator.onended = null;
      try { oscillator.stop(); } catch (_) { /* already stopped */ }
      for (const node of [oscillator, envelope, delay, feedback, echoes]) node.disconnect();
      this.eyeEffects.delete(cleanup);
    };
    this.eyeEffects.add(cleanup);
    oscillator.onended = cleanup;
    return true;
  },

  triggerSnare(strength, positionY = height / 2) {
    if (!this.context || !this.enabled || this.context.state !== "running" || APP.mode !== 2) return;
    const c = this.context, now = c.currentTime;
    if (!this.snareBuffer) {
      this.snareBuffer = c.createBuffer(1, Math.ceil(c.sampleRate * 0.32), c.sampleRate);
      const data = this.snareBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.65;
    }
    const notes = buildAudioScaleRange(45, 69);
    const note = notes[Math.round(constrain(1 - positionY / max(height, 1), 0, 1) * (notes.length - 1))];
    const fundamental = midiHz(note);
    this.lastSnareMidi = note;
    const noise = c.createBufferSource(), filter = c.createBiquadFilter();
    noise.buffer = this.snareBuffer;
    filter.type = "highpass"; filter.frequency.value = lerp(800, 2400, (note - 45) / 24);
    noise.connect(filter); filter.connect(this.snareGain);
    const body = c.createOscillator(), bodyGain = c.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(fundamental * 1.35, now);
    body.frequency.exponentialRampToValueAtTime(fundamental, now + 0.065);
    bodyGain.gain.setValueAtTime(0.35, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    body.connect(bodyGain); bodyGain.connect(this.snareGain);
    const gain = this.snareGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0.0001, now);
    gain.exponentialRampToValueAtTime(0.3 + strength * 0.38, now + 0.003);
    gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    gain.setTargetAtTime(0, now + 0.24, 0.015);
    noise.start(now); body.start(now); body.stop(now + 0.14);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); };
    body.onended = () => { body.disconnect(); bodyGain.disconnect(); };
  },

  setReverb(value) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.dryGain.gain.setTargetAtTime(1 - value * 0.28, now, 0.05);
    this.wetGain.gain.setTargetAtTime(value, now, 0.05);
  },

  silence() {
    for (const voice of this.voices || [this]) voice.silenceVoice();
  },

  silenceVoice() {
    if (!this.graphReady) return;
    for (const cleanup of this.eyeEffects) cleanup();
    const now = this.context.currentTime;
    for (const node of [this.continuousGain, this.kickGain, this.noiseMotionGain, this.noiseBurstGain, this.snareGain, this.impactGain, this.effectGain]) {
      node.gain.cancelScheduledValues(now);
    }
    this.impactGain.gain.setTargetAtTime(0, now, 0.03);
    this.effectGain.gain.setTargetAtTime(0, now, 0.03);
    this.snareGain.gain.setTargetAtTime(0, now, 0.03);
    this.continuousGain.gain.setTargetAtTime(0, now, 0.08);
    this.kickGain.gain.setTargetAtTime(0, now, 0.08);
    this.noiseMotionGain.gain.setTargetAtTime(0, now, 0.12);
    this.noiseBurstGain.gain.setTargetAtTime(0, now, 0.12);
  },

  setActiveMode(mode) {
    for (const voice of this.voices || [this]) voice.setVoiceMode(mode);
  },

  setVoiceMode(mode) {
    if (this.eyeEffects) for (const cleanup of this.eyeEffects) cleanup();
    this.activeMode = mode;
    this.wasRecent = false;
    this.lastKickTime = millis();
    if (!this.graphReady) return;
    const now = this.context.currentTime;
    const params = [
      this.impactGain.gain,
      this.effectGain.gain,
      this.snareGain.gain,
      this.continuousGain.gain,
      this.kickGain.gain,
      this.noiseMotionGain.gain,
      this.noiseBurstGain.gain,
      this.kickOscillator.frequency
    ];
    for (const param of params) param.cancelScheduledValues(now);
    this.impactGain.gain.setTargetAtTime(0, now, 0.025);
    this.effectGain.gain.setTargetAtTime(0, now, 0.025);
    this.arpActive = false;
    this.snareGain.gain.setTargetAtTime(0, now, 0.025);
    this.continuousGain.gain.setTargetAtTime(0, now, 0.025);
    this.kickGain.gain.setTargetAtTime(0, now, 0.025);
    this.noiseMotionGain.gain.setTargetAtTime(0, now, 0.035);
    this.noiseBurstGain.gain.setTargetAtTime(0, now, 0.035);
    this.lastUpdateTime = now;
  }
};

function buildAudioScale(root, octaves) {
  const notes = [], pentatonic = [0, 3, 5, 7, 10];
  for (let octave = 0; octave < octaves; octave++) {
    for (const interval of pentatonic) notes.push(root + octave * 12 + interval);
  }
  notes.push(root + octaves * 12);
  return notes;
}

function buildAudioScaleRange(lowest, highest) {
  const notes = [];
  const pentatonic = [0, 3, 5, 7, 10];
  for (let midi = lowest; midi <= highest; midi++) {
    if (pentatonic.includes((midi - lowest) % 12)) notes.push(midi);
  }
  if (notes[notes.length - 1] !== highest) notes.push(highest);
  return notes;
}

function createPinkNoise(context) {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let smooth = 0;
  for (let i = 0; i < length; i++) {
    smooth = smooth * 0.95 + (Math.random() * 2 - 1) * 0.05;
    data[i] = smooth;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function createAudioImpulse(context, seconds) {
  const length = floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let tap = 0; tap < 44; tap++) {
      const index = min(length - 1, floor((0.016 + tap * 0.06 + channel * 0.006) * context.sampleRate));
      data[index] += pow(0.9, tap) * (tap % 2 ? -0.66 : 1);
    }
  }
  return impulse;
}

function midiHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function midiLabel(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[(midi % 12 + 12) % 12] + (floor(midi / 12) - 1);
}

// Independent oscillator/envelope/filter chains, sharing only the browser context.
function createAudioVoice(context) {
  const voice = Object.create(AudioEngine);
  Object.assign(voice, { currentMidi: 45, previousMidi: 45, currentNoteIndex: 0,
    lastKickTime: -1000, activeMode: APP.mode, mode2GlideHz: midiHz(MODE2_LOWEST_MIDI),
    lastUpdateTime: 0, wasRecent: false, voices: null, graphReady: false });
  voice.create(context);
  return voice;
}

// A wide velocity range keeps gentle and energetic gestures audibly distinct.
function audioGestureEnergy(input) {
  const movement = input.gestureSpeed * 0.9 + input.motionEnergy * 0.22;
  const pressure = input.active && input.pressureAvailable ? input.pressure * 0.9 : 0;
  return constrain(Math.max(movement, pressure) * input.params.motionReactivity, 0, 1);
}

function audioVoiceForInput(input) {
  const slot = APP.touchInputUsed ? APP.touchVoices.indexOf(input) : 0;
  return AudioEngine.voices?.[Math.max(0, slot)] || AudioEngine;
}
