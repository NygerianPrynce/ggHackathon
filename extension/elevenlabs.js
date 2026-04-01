/**
 * ElevenLabs TTS helper — runs in the side panel context (not the service worker).
 * Call speakText(text) to play speech. Respects the global mute flag.
 * Returns a Promise that resolves when the audio finishes (or is stopped/errors).
 */
window.ElevenLabsTTS = (() => {
  let currentAudio = null;
  let currentResolve = null;
  let muted = false;

  function isMuted() { return muted; }
  function setMuted(val) { muted = val; }

  function _resolve() {
    if (currentResolve) {
      const fn = currentResolve;
      currentResolve = null;
      fn();
    }
  }

  function preprocessTTS(text) {
    return text
      .replace(/\b911\b/g, "nine one one")
      .replace(/\bVUPD\b/g, "V U P D");
  }

  async function speakText(text) {
    if (muted || !text) return Promise.resolve();

    // Stop anything currently playing and resolve its promise
    stopSpeaking();

    text = preprocessTTS(text);

    const apiKey = (typeof self !== "undefined" && self.ELEVENLABS_API_KEY) ? self.ELEVENLABS_API_KEY : "";
    const voiceId = (typeof self !== "undefined" && self.ELEVENLABS_VOICE_ID) ? self.ELEVENLABS_VOICE_ID : "cgSgspJ2msm6clMCkdW9";

    if (!apiKey) {
      console.warn("[ElevenLabs] No API key — set self.ELEVENLABS_API_KEY in openai-secrets.js");
      return Promise.resolve();
    }

    return new Promise(async (resolve) => {
      currentResolve = resolve;

      try {
        const res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "/stream", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_turbo_v2",
            voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.15 },
          }),
        });

        if (!res.ok) {
          console.error("[ElevenLabs] API error", res.status, await res.text());
          _resolve();
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          _resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          _resolve();
        };
        audio.play().catch((e) => {
          console.error("[ElevenLabs] play error", e);
          _resolve();
        });
      } catch (e) {
        console.error("[ElevenLabs] fetch error", e);
        _resolve();
      }
    });
  }

  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    _resolve();
  }

  return { speakText, stopSpeaking, isMuted, setMuted };
})();
