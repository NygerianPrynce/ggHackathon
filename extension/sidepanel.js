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
    async startListening(hooks) {
      if (this.mode === "elevenlabs") {
        if (typeof this.elevenLabsStart === "function") {
          this.elevenLabsStart(hooks);
          return;
        }
        hooks.onError("ElevenLabs: set VoiceProvider.elevenLabsStart = (hooks) => { … } then call hooks.onFinal(text).");
        return;
      }
      await startTapToSpeak(hooks);
    },

    stopListening() {
      tapState.keepListening = false;
      if (this.mode === "tap" && tapState.recognition) {
        try {
          tapState.recognition.stop();
        } catch (_) {}
      } else if (window.VoiceVisualizer) {
        window.VoiceVisualizer.stop();
      }
      if (this.mode === "elevenlabs" && typeof this.elevenLabsStop === "function") {
        this.elevenLabsStop();
      }
    },

    /** Optional: stop callback for ElevenLabs */
    elevenLabsStop: null,
  };

  const tapState = { recognition: null, keepListening: false };

  async function startTapToSpeak(hooks) {
    /**
     * Do not call getUserMedia here. A second mic client alongside Web Speech API
     * competes for capture on Windows/Chrome and delays or drops the first words.
     * Visualizer uses transcript-driven motion only (`startSpeechDriven` + `bumpFromSpeech`).
     */
    if (window.VoiceVisualizer) window.VoiceVisualizer.startSpeechDriven();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (window.VoiceVisualizer) window.VoiceVisualizer.stop();
      hooks.onError("Speech recognition not supported in this context.");
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    let lastCombined = "";
    let prevTranscriptLen = 0;
    /** Auto-stop after 1.5 s of silence — triggers onend → onFinal → auto-send */
    let silenceTimer = null;

    function resetSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (tapState.recognition) tapState.recognition.stop();
      }, 750);
    }

    rec.onstart = () => {
      prevTranscriptLen = 0;
      // Don't start the silence timer yet — wait until the user actually says something
      if (window.VoiceVisualizer && typeof window.VoiceVisualizer.bumpFromSpeech === "function") {
        window.VoiceVisualizer.bumpFromSpeech(2);
      }
    };

    /**
     * Rebuild the full string from results[0..length-1] every time.
     * If we only iterated from resultIndex, older indices that *just* became final
     * would be skipped — the first phrase often disappears (classic Chrome bug).
     */
    rec.onresult = (e) => {
      let finalPart = "";
      let interimPart = "";
      for (let i = 0; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalPart += piece + " ";
        } else {
          interimPart += piece;
        }
      }
      lastCombined = (finalPart + interimPart).trim().replace(/\s+/g, " ");
      if (window.VoiceVisualizer && typeof window.VoiceVisualizer.bumpFromSpeech === "function") {
        const delta = lastCombined.length - prevTranscriptLen;
        prevTranscriptLen = lastCombined.length;
        if (delta > 0) window.VoiceVisualizer.bumpFromSpeech(delta);
      }
      hooks.onPartial(lastCombined);
      // Only start the silence countdown once the user has actually said something
      if (lastCombined.length > 0) resetSilenceTimer();
    };

    rec.onend = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      tapState.recognition = null;
      tapState.keepListening = false;
      if (window.VoiceVisualizer) window.VoiceVisualizer.stop();
      const t = lastCombined.trim();
      if (t) hooks.onFinal(t);
    };

    rec.onerror = (e) => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      tapState.recognition = null;
      tapState.keepListening = false;
      if (window.VoiceVisualizer) window.VoiceVisualizer.stop();
      if (e.error === "no-speech") hooks.onError("No speech detected.");
      else if (e.error === "not-allowed") hooks.onError("Microphone denied.");
      else if (e.error === "aborted") {
        /* user cancelled mic — UI already reset by stopListening */
      } else hooks.onError(e.error || "speech error");
    };

    tapState.recognition = rec;
    tapState.keepListening = true;
    rec.start();
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  const micBtn = document.getElementById("mic-btn");
  const micLabel = document.getElementById("mic-label");
  const transcript = document.getElementById("transcript");
  const sendBtn = document.getElementById("send-btn");
  const statusEl = document.getElementById("status");
  const questionBanner = document.getElementById("question-banner");
  const muteBtn = document.getElementById("mute-btn");

  let pollTimer = null;
  let isRecording = false;
  /** True while a RUN_BOT / follow-up round-trip is in progress (blocks re-send until status updates). */
  let botBusy = false;
  let autoSendTimer = null;
  /** Only clear transcript when the bot asks a *new* question (poll was wiping text every 1.5s). */
  let lastQuestionText = "";
  /** Set when the contact number question has been shown — mic locks on the next filling_form after this. */
  let sawContactQuestion = false;
  /** Once the phone number answer is processed, never auto-open mic again. */
  let conversationDone = false;

  // ── Mute toggle ────────────────────────────────────────────────────────
  muteBtn.addEventListener("click", () => {
    const tts = window.ElevenLabsTTS;
    if (!tts) return;
    const nowMuted = !tts.isMuted();
    tts.setMuted(nowMuted);
    if (nowMuted) {
      tts.stopSpeaking();
      muteBtn.textContent = "🔇";
      muteBtn.classList.add("muted");
    } else {
      muteBtn.textContent = "🔊";
      muteBtn.classList.remove("muted");
    }
  });

  function refreshSendEnabled() {
    const hasText = transcript.value.trim().length > 0;
    sendBtn.disabled = isRecording || botBusy || !hasText;
  }

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

  function cancelAutoSend() {
    if (autoSendTimer) {
      clearTimeout(autoSendTimer);
      autoSendTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(checkBotStatus, 800);
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
        botBusy = false;
        if (data.isContactNumberQuestion) sawContactQuestion = true;
        showQuestion(data.question);
        if (data.question !== lastQuestionText) {
          transcript.value = "";
          lastQuestionText = data.question;
          const ttsPromise = window.ElevenLabsTTS
            ? window.ElevenLabsTTS.speakText(data.question)
            : Promise.resolve();
          ttsPromise.then(() => {
            // Small gap so Chrome's SpeechRecognition engine has time to
            // fully tear down the previous session before starting a new one.
            // Never auto-open mic once form filling has started.
            setTimeout(() => {
              if (!isRecording && !conversationDone) micBtn.click();
            }, 350);
          });
        }
        setStatus("question", "💬 Type your answer below or use the mic, then Send to bot.");
        transcript.placeholder = "Type or speak your answer…";
        refreshSendEnabled();
      } else if (data.status === "done") {
        stopPolling();
        botBusy = false;
        hideQuestion();
        lastQuestionText = "";
        transcript.placeholder = "Describe your issue — type here or use the mic…";
        setStatus("done", "✅ Form filled — review the ReADY tab and submit manually.");
        refreshSendEnabled();
      } else if (data.status === "filling_form" || data.raw_step === "filling_form") {
        if (sawContactQuestion) conversationDone = true;
        hideQuestion();
        botBusy = true;
        setStatus("working", '<span class="spinner"></span> Filling form…');
        refreshSendEnabled();
      } else if (data.status === "error") {
        stopPolling();
        botBusy = false;
        hideQuestion();
        lastQuestionText = "";
        transcript.placeholder = "Describe your issue — type here or use the mic…";
        setStatus("error", "⚠️ " + (data.message || "Error"));
        refreshSendEnabled();
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function submitIssue(text) {
    if (typeof pipelineLog === "function") pipelineLog("ui", "submitIssue → RUN_BOT", text);
    lastUiStatusKey = "";
    lastQuestionText = "";
    sawContactQuestion = false;
    conversationDone = false;
    botBusy = true;
    refreshSendEnabled();
    setStatus("working", '<span class="spinner"></span> Sending…');
    hideQuestion();

    try {
      const res = await chrome.runtime.sendMessage({ type: "RUN_BOT", issue: text });
      if (res?.ok) {
        botBusy = true;
        setStatus("working", "🤖 " + (res.message || "Started"));
        startPolling();
        refreshSendEnabled();
      } else {
        botBusy = false;
        setStatus("error", "⚠️ " + (res?.error || "Could not start"));
        refreshSendEnabled();
      }
    } catch (err) {
      botBusy = false;
      setStatus("error", "⚠️ " + (err?.message || String(err)));
      refreshSendEnabled();
    }
  }

  async function submitFollowUp(text) {
    if (typeof pipelineLog === "function") pipelineLog("ui", "submitFollowUp → ANSWER_FOLLOWUP", text);
    botBusy = true;
    refreshSendEnabled();
    setStatus("working", '<span class="spinner"></span> Sending answer…');
    try {
      await chrome.runtime.sendMessage({ type: "ANSWER_FOLLOWUP", text });
      botBusy = true;
      startPolling();
      refreshSendEnabled();
    } catch (err) {
      botBusy = false;
      setStatus("error", "⚠️ " + (err?.message || String(err)));
      refreshSendEnabled();
    }
  }

  function scheduleAutoSend(text) {
    cancelAutoSend();
    autoSendTimer = setTimeout(() => {
      autoSendTimer = null;
      if (text === transcript.value.trim()) {
        const answering = questionBanner.classList.contains("visible");
        if (answering) submitFollowUp(text);
        else submitIssue(text);
      }
    }, 1000);
  }

  micBtn.addEventListener("click", async () => {
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
      refreshSendEnabled();
      return;
    }

    cancelAutoSend();
    if (window.ElevenLabsTTS) window.ElevenLabsTTS.stopSpeaking();
    transcript.value = "";
    isRecording = true;
    refreshSendEnabled();
    micBtn.classList.add("recording");
    micLabel.textContent = "Listening…";
    setStatus("listening", "🎧 Listening…");

    await VoiceProvider.startListening({
      onPartial: (t) => {
        transcript.value = t;
      },
      onFinal: (t) => {
        isRecording = false;
        micBtn.classList.remove("recording");
        micLabel.textContent = "Tap to speak";
        const norm =
          typeof globalThis.normalizeSpokenNumbersToDigits === "function"
            ? globalThis.normalizeSpokenNumbersToDigits(t)
            : t;
        transcript.value = norm;
        if (norm.length > 0) {
          setStatus("done", "✅ Got it — sending…");
          scheduleAutoSend(norm);
        } else {
          setStatus("", "Ready — tap the mic or type below.");
        }
        refreshSendEnabled();
      },
      onError: (msg) => {
        isRecording = false;
        micBtn.classList.remove("recording");
        micLabel.textContent = "Tap to speak";
        setStatus("error", "⚠️ " + msg);
        refreshSendEnabled();
      },
    });
  });

  sendBtn.addEventListener("click", () => {
    cancelAutoSend();
    const raw = transcript.value.trim();
    const text =
      typeof globalThis.normalizeSpokenNumbersToDigits === "function"
        ? globalThis.normalizeSpokenNumbersToDigits(raw)
        : raw;
    if (!text) return;
    const answering = questionBanner.classList.contains("visible");
    if (answering) submitFollowUp(text);
    else submitIssue(text);
  });

  transcript.addEventListener("input", () => {
    refreshSendEnabled();
  });

  transcript.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });

  refreshSendEnabled();

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
