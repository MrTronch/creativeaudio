window.UI = {
  init: initUI,
  togglePanel: toggleControlPanel,
  updateAudioButton
};

// UI bindings are isolated here.
function initUI() {
  bindControl("shape-size", value => {
    APP.params.shapeSize = value;
    Mode1.signature = "";
  });
  bindControl("influence-radius", value => APP.params.influenceRadius = value);
  bindControl("motion-reactivity", value => APP.params.motionReactivity = value);
  bindControl("audio-noise", value => APP.params.audioNoise = value);
  bindControl("pitch", value => APP.params.pitch = value);
  bindControl("trail-persistence", value => APP.params.trailPersistence = value);

  document.getElementById("audio-toggle").addEventListener("click", () => AudioEngine.toggle());
  document.getElementById("panel-toggle").addEventListener("click", toggleControlPanel);
}

function bindControl(id, update) {
  const control = document.getElementById(id);
  update(Number(control.value));
  control.addEventListener("input", event => update(Number(event.target.value)));
}

function toggleControlPanel() {
  const panel = document.getElementById("controls");
  const button = document.getElementById("panel-toggle");
  const collapsed = panel.classList.toggle("collapsed");
  button.textContent = collapsed ? "+" : "âˆ’";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Abrir controles" : "Minimizar controles");
}

function updateAudioButton() {
  const button = document.getElementById("audio-toggle");
  button.disabled = AudioEngine.initializing;
  button.setAttribute("aria-busy", String(AudioEngine.initializing));
  button.setAttribute("aria-live", "polite");
  button.title = AudioEngine.startError || "";
  const running = AudioEngine.enabled && AudioEngine.context?.state === "running";
  const suspended = AudioEngine.enabled && !running;
  button.textContent = AudioEngine.initializing ? "ACTIVANDO…" : AudioEngine.startError ? AudioEngine.startError : suspended ? "START AUDIO" : running ? "AUDIO ON" : (AudioEngine.startedOnce ? "AUDIO OFF" : "START AUDIO");
  button.classList.toggle("is-on", running);
  button.classList.toggle("is-off", AudioEngine.startedOnce && !running);
}
function syncShapeSizeLimit() {
  const slider = document.getElementById("shape-size");
  slider.step = APP.mode === 1 ? "0.0025" : "0.05";
  slider.max = APP.mode === 1 ? "1.7875" : "2.2";
  const value = Math.min(APP.params.shapeSize, Number(slider.max));
  slider.value = String(value);
  APP.params.shapeSize = value;
  Mode1.signature = "";
}
