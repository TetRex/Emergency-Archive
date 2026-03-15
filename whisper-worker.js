// Offline speech-to-text worker using Whisper via transformers.js
// Audio is processed entirely on-device — no network required after first model download.
importScripts("./transformers.min.js");

// Use locally bundled model and runtime files — fully offline.
self.transformers.env.allowLocalModels  = true;
self.transformers.env.allowRemoteModels = false;
self.transformers.env.localModelPath    = "./models/";
self.transformers.env.useBrowserCache   = false;
// Point ONNX runtime to local WASM files instead of CDN.
self.transformers.env.backends.onnx.wasm.wasmPaths = "./";

let transcriber = null;

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    try {
      self.postMessage({ type: "status", msg: "Loading speech model…" });
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
    if (!transcriber) {
      self.postMessage({ type: "error", msg: "Model not ready yet, please try again." });
      return;
    }
    try {
      // data.audio = Float32Array at 16 kHz (mono)
      const result = await transcriber(data.audio, { language: "en", task: "transcribe" });
      self.postMessage({ type: "result", text: result.text.trim() });
    } catch (e) {
      self.postMessage({ type: "error", msg: e.message });
    }
  }
};
