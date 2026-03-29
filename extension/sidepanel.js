/**
 * Side panel UI + voice capture.
 *
 * ElevenLabs: when you add the package, implement `VoiceProvider` below
 * (mode `elevenlabs`) and call `onTranscriptFinal(text)` / `onTranscriptPartial(text)`
 * from your SDK callbacks. The rest of the panel (RUN_BOT, polling) stays the same.
 */
(() => {
  "use strict";

  let lastUiStatusKey = "";

  // ── Voice provider (swap for ElevenLabs) ───────────────────────────────
  const VoiceProvider = {
    /** @type {"tap" | "elevenlabs"} */
    mode: "tap",

    /**
     * Assign when you add the ElevenLabs SDK: a function that receives the same
     * hooks as tap mode and starts your session (WebSocket / SDK).
     * @type {((hooks: { onPartial: (t: string) => void, onFinal: (t: string) => void, onError: (msg: string) => void }) => void) | null}
     */
    elevenLabsStart: null,

    /**
     * @param {{ onPartial: (t: string) => void, onFinal: (t: string) => void, onError: (msg: string) => void }} hooks
     */
    startListening(hooks) {
      if (this.mode === "elevenlabs") {
        if (typeof this.elevenLabsStart === "function") {
          this.elevenLabsStart(hooks);
          return;
        }
        hooks.onError("ElevenLabs: set VoiceProvider.elevenLabsStart = (hooks) => { … } then call hooks.onFinal(text).");
        return;
      }
      startTapToSpeak(hooks);
    },

    stopListening() {
      if (this.mode === "tap" && tapState.recognition) {
        try {
          tapState.recognition.stop();
        } catch (_) {}
      }
      if (this.mode === "elevenlabs" && typeof this.elevenLabsStop === "function") {
        this.elevenLabsStop();
      }
    },

    /** Optional: stop callback for ElevenLabs */
    elevenLabsStop: null,
  };

  const tapState = { recognition: null };

  function startTapToSpeak(hooks) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      hooks.onError("Speech recognition not supported in this context.");
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let lastCombined = "";
    rec.onstart = () => {
      finalText = "";
      lastCombined = "";
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      lastCombined = (finalText + interim).trim();
      hooks.onPartial(lastCombined);
    };
    rec.onend = () => {
      tapState.recognition = null;
      const t = lastCombined.trim();
      if (t) hooks.onFinal(t);
    };
    rec.onerror = (e) => {
      tapState.recognition = null;
      if (e.error === "no-speech") hooks.onError("No speech detected.");
      else if (e.error === "not-allowed") hooks.onError("Microphone denied.");
      else hooks.onError(e.error || "speech error");
    };

    tapState.recognition = rec;
    rec.start();
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  const micBtn = document.getElementById("mic-btn");
  const micLabel = document.getElementById("mic-label");
  const transcript = document.getElementById("transcript");
  const sendBtn = document.getElementById("send-btn");
  const statusEl = document.getElementById("status");
  const questionBanner = document.getElementById("question-banner");

  let pollTimer = null;
  let isRecording = false;

  function setStatus(cls, html) {
    statusEl.className = cls || "";
    statusEl.innerHTML = html;
  }

  function showQuestion(text) {
    questionBanner.textContent = text;
    questionBanner.classList.add("visible");
  }

  function hideQuestion() {
    questionBanner.classList.remove("visible");
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(checkBotStatus, 1500);
  }

  async function checkBotStatus() {
    try {
      const data = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (!data) return;

      const key = [data.status, data.question || "", data.message || ""].join("|");
      if (typeof pipelineLog === "function" && key !== lastUiStatusKey) {
        lastUiStatusKey = key;
        pipelineLog("ui·poll", "status → UI", {
          status: data.status,
          question: data.question,
          raw_step: data.raw_step,
        });
      }

      if (data.status === "waiting" && data.question) {
        showQuestion(data.question);
        setStatus("question", "🎙️ Answer via mic (tap), then send or wait for auto-send.");
        transcript.value = "";
        transcript.placeholder = "Speak your answer…";
        sendBtn.disabled = true;
      } else if (data.status === "done") {
        stopPolling();
        hideQuestion();
        transcript.placeholder = "Transcript appears here…";
        setStatus("done", "✅ Form filled — review the ReADY tab and submit manually.");
        sendBtn.disabled = false;
      } else if (data.status === "filling_form" || data.raw_step === "filling_form") {
        hideQuestion();
        setStatus("working", '<span class="spinner"></span> Filling form…');
      } else if (data.status === "error") {
        stopPolling();
        hideQuestion();
        transcript.placeholder = "Transcript appears here…";
        setStatus("error", "⚠️ " + (data.message || "Error"));
        sendBtn.disabled = false;
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function submitIssue(text) {
    if (typeof pipelineLog === "function") pipelineLog("ui", "submitIssue → RUN_BOT", text);
    lastUiStatusKey = "";
    sendBtn.disabled = true;
    setStatus("working", '<span class="spinner"></span> Sending…');
    hideQuestion();

    try {
      const res = await chrome.runtime.sendMessage({ type: "RUN_BOT", issue: text });
      if (res?.ok) {
        setStatus("working", "🤖 " + (res.message || "Started"));
        startPolling();
      } else {
        setStatus("error", "⚠️ " + (res?.error || "Could not start"));
        sendBtn.disabled = false;
      }
    } catch (err) {
      setStatus("error", "⚠️ " + (err?.message || String(err)));
      sendBtn.disabled = false;
    }
  }

  async function submitFollowUp(text) {
    if (typeof pipelineLog === "function") pipelineLog("ui", "submitFollowUp → ANSWER_FOLLOWUP", text);
    sendBtn.disabled = true;
    setStatus("working", '<span class="spinner"></span> Sending answer…');
    try {
      await chrome.runtime.sendMessage({ type: "ANSWER_FOLLOWUP", text });
      startPolling();
    } catch (err) {
      setStatus("error", "⚠️ " + (err?.message || String(err)));
      sendBtn.disabled = false;
    }
  }

  function autoSend(text) {
    setTimeout(() => {
      if (text === transcript.value.trim()) {
        const answering = questionBanner.classList.contains("visible");
        if (answering) submitFollowUp(text);
        else submitIssue(text);
      }
    }, 1200);
  }

  micBtn.addEventListener("click", () => {
    if (VoiceProvider.mode === "elevenlabs") {
      if (!VoiceProvider.elevenLabsStart) {
        setStatus("error", "Assign VoiceProvider.elevenLabsStart or switch mode to tap.");
        return;
      }
    }
    if (isRecording) {
      VoiceProvider.stopListening();
      isRecording = false;
      micBtn.classList.remove("recording");
      micLabel.textContent = "Tap to speak";
      return;
    }

    transcript.value = "";
    sendBtn.disabled = true;
    isRecording = true;
    micBtn.classList.add("recording");
    micLabel.textContent = "Listening…";
    setStatus("listening", "🎧 Listening…");

    VoiceProvider.startListening({
      onPartial: (t) => {
        transcript.value = t;
      },
      onFinal: (t) => {
        isRecording = false;
        micBtn.classList.remove("recording");
        micLabel.textContent = "Tap to speak";
        transcript.value = t;
        if (t.length > 0) {
          sendBtn.disabled = false;
          setStatus("done", "✅ Got it — sending…");
          autoSend(t);
        } else {
          setStatus("", "Ready — tap the mic");
        }
      },
      onError: (msg) => {
        isRecording = false;
        micBtn.classList.remove("recording");
        micLabel.textContent = "Tap to speak";
        setStatus("error", "⚠️ " + msg);
      },
    });
  });

  sendBtn.addEventListener("click", () => {
    const text = transcript.value.trim();
    if (!text) return;
    const answering = questionBanner.classList.contains("visible");
    if (answering) submitFollowUp(text);
    else submitIssue(text);
  });

  // Expose for ElevenLabs inline script or future bundle
  window.__READYBOT_VOICE__ = {
    VoiceProvider,
    submitIssue,
    submitFollowUp,
    setTranscript: (t) => {
      transcript.value = t;
    },
  };
})();
