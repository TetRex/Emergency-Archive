// Offline speech-to-text worker using Whisper via transformers.js
// Audio is processed entirely on-device — no network required after first model download.
importScripts("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js");

// Cache the model in the browser (IndexedDB) so it only downloads once.
self.transformers.env.allowLocalModels  = false;
self.transformers.env.useBrowserCache   = true;

let transcriber = null;

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    try {
      self.postMessage({ type: "status", msg: "Downloading speech model (first time only, ~75 MB)…" });
      transcriber = await self.transformers.pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        { progress_callback: (p) => {
            if (p.status === "progress") {
              const pct = Math.round(p.progress ?? 0);
              self.postMessage({ type: "status", msg: `Loading model… ${pct}%` });
            }
          }
        }
      );
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "error", msg: e.message });
    }
  }

  if (data.type === "transcribe") {
    try {
      // data.audio = Float32Array at 16 kHz (mono)
      const result = await transcriber(data.audio, { language: "en", task: "transcribe" });
      self.postMessage({ type: "result", text: result.text.trim() });
    } catch (e) {
      self.postMessage({ type: "error", msg: e.message });
    }
  }
};
