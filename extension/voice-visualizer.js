/**
 * Circular gold voice visualizer (SVG).
 * - `start(stream)` — Web Audio AnalyserNode.
 * - `startSpeechDriven()` — animates from `bumpFromSpeech()` (STT); no extra mic capture.
 */
(() => {
  "use strict";

  let audioCtx = null;
  let sourceNode = null;
  let analyser = null;
  let streamRef = null;
  let rafId = 0;
  let midLines = [];
  let smoothed = null;

  let speechMode = false;
  let speechTarget = 0;
  let speechEnergy = 0;
  let speechDisplay = 0;

  const N_OUTER = 72;
  const N_MID = 20;
  const SPEECH_BINS = 128;

  function $(id) {
    return document.getElementById(id);
  }

  function ensureMidLines(svg) {
    const g = $("viz-mid");
    if (!g || midLines.length) return;
    for (let i = 0; i < N_MID; i++) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", "url(#viz-mid-grad)");
      line.setAttribute("stroke-width", "5");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("opacity", "0.85");
      g.appendChild(line);
      midLines.push(line);
    }
  }

  function stopTracks() {
    if (streamRef) {
      streamRef.getTracks().forEach((t) => t.stop());
      streamRef = null;
    }
  }

  function disconnectAudio() {
    try {
      if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
      }
      if (analyser) {
        analyser.disconnect();
        analyser = null;
      }
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close();
      }
    } catch (_) {}
    audioCtx = null;
  }

  function tick() {
    const outer = $("viz-outer");
    const core = $("viz-core-group");
    const wf = $("viz-wireframe");
    if (!outer) {
      rafId = 0;
      return;
    }

    const t = performance.now() * 0.001;
    let bins = SPEECH_BINS;

    if (speechMode) {
      speechTarget *= 0.985;
      speechEnergy += (speechTarget - speechEnergy) * 0.26;
      speechDisplay += (speechEnergy - speechDisplay) * 0.14;
      if (!smoothed || smoothed.length !== SPEECH_BINS) {
        smoothed = new Float32Array(SPEECH_BINS);
      }
      const flow = speechEnergy;
      for (let i = 0; i < SPEECH_BINS; i++) {
        const w =
          0.38 +
          0.62 * Math.sin(i * 0.28 + t * (2.8 + flow * 3.2) + i * 0.018);
        const target = Math.min(1, flow * 1.06) * w;
        smoothed[i] = smoothed[i] * 0.82 + target * 0.18;
      }
    } else {
      if (!analyser) {
        rafId = 0;
        return;
      }
      bins = analyser.frequencyBinCount;
      const data = new Uint8Array(bins);
      analyser.getByteFrequencyData(data);
      if (!smoothed || smoothed.length !== bins) {
        smoothed = new Float32Array(bins);
      }
      for (let i = 0; i < bins; i++) {
        smoothed[i] = smoothed[i] * 0.65 + (data[i] / 255) * 0.35;
      }
    }

    let sum = 0;
    for (let i = 0; i < Math.min(16, bins); i++) sum += smoothed[i];
    const levelRaw = sum / Math.min(16, bins);
    const level = speechMode ? speechDisplay : levelRaw;

    const cx = 100;
    const cy = 100;
    const baseOuter = 82;
    let d = "";
    for (let i = 0; i <= N_OUTER; i++) {
      const ang = (i / N_OUTER) * Math.PI * 2 - Math.PI / 2;
      const bin = Math.min(bins - 1, Math.floor((i / N_OUTER) * 48) + 2);
      const v = smoothed[bin];
      const wobble =
        v * 20 +
        Math.sin(i * 0.32 + t * (2.2 + v * 2.8)) * (1.1 + v * 5.5);
      const r = baseOuter + wobble;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    d += " Z";
    outer.setAttribute("d", d);

    const rInner = 46;
    for (let i = 0; i < N_MID; i++) {
      const line = midLines[i];
      if (!line) continue;
      const ang = (i / N_MID) * Math.PI * 2 - Math.PI / 2;
      const bin = 4 + Math.floor((i / N_MID) * 40);
      const v = smoothed[Math.min(bin, bins - 1)];
      const ext = 6 + v * 26;
      const x1 = Math.cos(ang) * rInner;
      const y1 = Math.sin(ang) * rInner;
      const x2 = Math.cos(ang) * (rInner + ext);
      const y2 = Math.sin(ang) * (rInner + ext);
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      line.setAttribute("opacity", String(0.45 + v * 0.5));
    }

    const pulse = 1 + level * 0.1 + Math.sin(t * 4.5) * 0.018 * level;
    if (core) {
      core.setAttribute("transform", `translate(100,100) scale(${pulse.toFixed(4)})`);
    }
    if (wf) {
      const spin = speechMode ? t * (8 + level * 22) : t * 12 + level * 30;
      wf.setAttribute("transform", `rotate(${spin % 360})`);
    }

    rafId = requestAnimationFrame(tick);
  }

  function startSpeechDriven() {
    stop();
    speechMode = true;
    speechTarget = 0.14;
    speechEnergy = 0.1;
    speechDisplay = 0.08;
    const svg = document.querySelector(".voice-viz-svg");
    ensureMidLines(svg);
    rafId = requestAnimationFrame(tick);
  }

  function bumpFromSpeech(deltaChars) {
    const d =
      typeof deltaChars === "number" && deltaChars >= 0 ? deltaChars : 3;
    const add = 0.05 + Math.min(0.55, d * 0.045);
    speechTarget = Math.min(1, speechTarget + add);
  }

  function start(stream) {
    stop();
    speechMode = false;
    streamRef = stream;
    const svg = document.querySelector(".voice-viz-svg");
    ensureMidLines(svg);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.88;
    sourceNode.connect(analyser);

    audioCtx.resume().then(() => {
      rafId = requestAnimationFrame(tick);
    });
  }

  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    smoothed = null;
    speechMode = false;
    speechTarget = 0;
    speechEnergy = 0;
    speechDisplay = 0;
    disconnectAudio();
    stopTracks();

    const outer = $("viz-outer");
    if (outer) {
      const cx = 100;
      const cy = 100;
      const r = 82;
      let d = "";
      for (let i = 0; i <= N_OUTER; i++) {
        const ang = (i / N_OUTER) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      d += " Z";
      outer.setAttribute("d", d);
    }
    const core = $("viz-core-group");
    if (core) core.setAttribute("transform", "translate(100,100) scale(1)");
    const wf = $("viz-wireframe");
    if (wf) wf.setAttribute("transform", "rotate(0)");
    for (let i = 0; i < midLines.length; i++) {
      const ang = (i / N_MID) * Math.PI * 2 - Math.PI / 2;
      const r1 = 46;
      const r2 = 52;
      midLines[i].setAttribute("x1", (Math.cos(ang) * r1).toFixed(2));
      midLines[i].setAttribute("y1", (Math.sin(ang) * r1).toFixed(2));
      midLines[i].setAttribute("x2", (Math.cos(ang) * r2).toFixed(2));
      midLines[i].setAttribute("y2", (Math.sin(ang) * r2).toFixed(2));
      midLines[i].setAttribute("opacity", "0.5");
    }
  }

  window.VoiceVisualizer = { start, startSpeechDriven, bumpFromSpeech, stop };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => stop());
  } else {
    stop();
  }
})();
